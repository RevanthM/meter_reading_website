#!/usr/bin/env node
/**
 * One-off backfill: walk S3 session folders (same layout as portal) → upsert DynamoDB.
 *
 * Usage:
 *   AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions node scripts/backfill-dynamo-sessions.mjs
 *   AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions node scripts/backfill-dynamo-sessions.mjs --work-type 1000
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';
import { WORK_TYPES, getS3FolderRootsForPortalWorkType } from '../server/sessionIndex/workTypes.js';
import { inferStatusAndSourceFromSessionPrefix } from '../server/sessionIndex/prefixInfer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

/** Prefer AWS_PROFILE over keys baked into src/.env (different IAM users). */
if (process.env.AWS_PROFILE) {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
}

const BUCKET = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
const TABLE = (process.env.AWS_DYNAMODB_SESSIONS_TABLE || '').trim();
const S3_BASE_PREFIX = (process.env.AWS_S3_BASE_PREFIX || '').trim();

const STATUS_FOLDER_MAP = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
};

const ALL_STATUSES = [
  'correct',
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
  'no_dials',
  'not_sure',
];

function withS3Base(relativePath) {
  const rel = relativePath.replace(/^\//, '');
  if (!S3_BASE_PREFIX) return rel;
  const base = S3_BASE_PREFIX.replace(/\/+$/, '');
  return `${base}/${rel}`;
}

function getAllFolderPrefixes(source, workType) {
  const prefixes = [];
  const sources = source === 'all' ? ['field', 'simulator'] : [source];

  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    for (const src of sources) {
      for (const status of ALL_STATUSES) {
        const srcPrefix = src === 'field' ? 'f_' : 's_';
        const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
        prefixes.push({
          folder: withS3Base(`${root}/${srcPrefix}${suffix}/`),
          status,
          sourceType: src,
        });
      }
    }
  }

  if (workType === '1000') {
    for (const src of sources) {
      for (const status of ALL_STATUSES) {
        const srcPrefix = src === 'field' ? 'f_' : 's_';
        const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
        prefixes.push({
          folder: withS3Base(`${srcPrefix}${suffix}/`),
          status,
          sourceType: src,
        });
      }
    }
    if (source === 'all' || source === 'field') {
      prefixes.push({ folder: withS3Base('correct/'), status: 'correct', sourceType: 'field' });
      prefixes.push({ folder: withS3Base('incorrect/'), status: 'incorrect_new', sourceType: 'field' });
    }
  }

  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    for (const src of sources) {
      const srcPrefix = src === 'field' ? 'f_' : 's_';
      prefixes.push({
        folder: withS3Base(`${root}/${srcPrefix}skipped_review/`),
        status: 'incorrect_new',
        sourceType: src,
      });
    }
  }

  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    prefixes.push({
      folder: withS3Base(`${root}/manually_uploaded/`),
      status: 'manually_uploaded',
      sourceType: 'simulator',
    });
  }

  const seen = new Set();
  return prefixes.filter((p) => {
    if (seen.has(p.folder)) return false;
    seen.add(p.folder);
    return true;
  });
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function listSessionPrefixes(s3, folderPrefix) {
  const normalized = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  const prefixes = [];
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: normalized,
        Delimiter: '/',
        ContinuationToken: token,
      }),
    );
    for (const cp of out.CommonPrefixes || []) {
      if (cp.Prefix) prefixes.push(cp.Prefix);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return prefixes;
}

async function countImagesUnderPrefix(s3, prefix) {
  let count = 0;
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of out.Contents || []) {
      const k = o.Key || '';
      if (/\.(jpe?g|png)$/i.test(k)) count += 1;
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return count;
}

async function backfillWorkType(s3, store, workType) {
  const folderJobs = getAllFolderPrefixes('all', workType);
  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const { folder, status, sourceType } of folderJobs) {
    const sessionPrefixes = await listSessionPrefixes(s3, folder);
    console.log(`📂 ${folder} → ${sessionPrefixes.length} sessions`);

    for (const prefix of sessionPrefixes) {
      const metaKey = `${prefix}metadata.json`;
      try {
        const metaOut = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: metaKey }));
        const metadata = JSON.parse(await streamToString(metaOut.Body));
        if (!metadata.session_id) {
          skipped += 1;
          continue;
        }
        const imageCount = await countImagesUnderPrefix(s3, prefix);
        const inferred = inferStatusAndSourceFromSessionPrefix(prefix);
        await store.upsertFromMetadata(metadata, {
          s3Bucket: BUCKET,
          s3SessionPrefix: prefix,
          folderStatus: status || inferred.status,
          sourceType: sourceType || inferred.sourceType,
          portalWorkType: workType,
          imageCount,
          metadataEtag: metaOut.ETag,
          ingestSource: 'portal_backfill',
        });
        upserted += 1;
        if (upserted % 50 === 0) console.log(`   … ${upserted} upserted`);
      } catch (e) {
        failed += 1;
        console.warn(`   ⚠️ ${metaKey}: ${e.message}`);
      }
    }
  }

  return { upserted, skipped, failed };
}

async function main() {
  if (!TABLE) {
    console.error('Set AWS_DYNAMODB_SESSIONS_TABLE (e.g. amr-sessions)');
    process.exit(1);
  }

  const workTypeArg = process.argv.find((a) => a.startsWith('--work-type='))?.split('=')[1];
  const workTypes = workTypeArg ? [workTypeArg] : WORK_TYPES;

  const clientConfig = { region: REGION };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  const s3 = new S3Client(clientConfig);

  const store = createSessionIndexStore({
    tableName: TABLE,
    region: REGION,
    ...(clientConfig.credentials ? { credentials: clientConfig.credentials } : {}),
  });

  console.log(`\n🔄 Backfill DynamoDB table ${TABLE} from s3://${BUCKET}/ (${REGION})\n`);

  let totalUpserted = 0;
  let totalFailed = 0;
  for (const wt of workTypes) {
    console.log(`\n=== Work type ${wt} ===`);
    const { upserted, failed } = await backfillWorkType(s3, store, wt);
    totalUpserted += upserted;
    totalFailed += failed;
  }

  console.log(`\n✅ Done: ${totalUpserted} upserted, ${totalFailed} failed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
