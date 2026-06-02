#!/usr/bin/env node
/**
 * Reclassify mis-tagged field sessions on S3 → simulator (awaiting review).
 *
 * Keep Field only when:
 *   - metadata.timestamp calendar day is 2026-05-29 … 2026-05-31 (UTC date), AND
 *   - collector is not an internal tester (reetika*, nirmala)
 *
 * Usage:
 *   node scripts/reclassify-field-sessions.mjs --dry-run
 *   node scripts/reclassify-field-sessions.mjs --execute
 *   AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions node scripts/reclassify-field-sessions.mjs --execute --work-type 1000
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';
import { WORK_TYPES, getS3FolderRootsForPortalWorkType } from '../server/sessionIndex/workTypes.js';
import { inferStatusAndSourceFromSessionPrefix } from '../server/sessionIndex/prefixInfer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

if (process.env.AWS_PROFILE) {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
}

const BUCKET = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
const TABLE = (process.env.AWS_DYNAMODB_SESSIONS_TABLE || '').trim();
const S3_BASE_PREFIX = (process.env.AWS_S3_BASE_PREFIX || '').trim();

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;

const FIELD_WINDOW_DAYS = new Set(['2026-05-29', '2026-05-30', '2026-05-31']);

const STATUS_FOLDER_MAP = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
};

const ALL_STATUSES = Object.keys(STATUS_FOLDER_MAP);

function withS3Base(relativePath) {
  const rel = relativePath.replace(/^\//, '');
  if (!S3_BASE_PREFIX) return rel;
  const base = S3_BASE_PREFIX.replace(/\/+$/, '');
  return `${base}/${rel}`;
}

function isInternalTestCollector(userName) {
  const name = String(userName || '').trim().toLowerCase();
  if (!name) return false;
  if (name.startsWith('reetika')) return true;
  if (name === 'nirmala') return true;
  return false;
}

function captureDayKey(iso) {
  if (!iso) return null;
  const m = String(iso).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function shouldStayField(metadata) {
  const userName = metadata.user_name || metadata.user_email || '';
  if (isInternalTestCollector(userName)) return false;
  const day = captureDayKey(metadata.timestamp);
  return Boolean(day && FIELD_WINDOW_DAYS.has(day));
}

function rewritePrefixSource(sourcePrefix, targetSource) {
  const norm = sourcePrefix.endsWith('/') ? sourcePrefix : `${sourcePrefix}/`;
  const parts = norm.split('/').filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const seg = parts[i];
    if (seg.startsWith('f_') || seg.startsWith('s_')) {
      const suffix = seg.slice(2);
      const modePrefix = targetSource === 'field' ? 'f_' : 's_';
      parts[i] = `${modePrefix}${suffix}`;
      return `${parts.join('/')}/`;
    }
    if (seg === 'correct' && targetSource === 'simulator') {
      parts[i] = 's_correct';
      return `${parts.join('/')}/`;
    }
    if (seg === 'incorrect' && targetSource === 'simulator') {
      parts[i] = 's_incorrect';
      return `${parts.join('/')}/`;
    }
  }
  return null;
}

function getFieldFolderPrefixes(workType) {
  const prefixes = [];
  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    for (const status of ALL_STATUSES) {
      const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
      prefixes.push({
        folder: withS3Base(`${root}/f_${suffix}/`),
        status,
      });
    }
    prefixes.push({
      folder: withS3Base(`${root}/f_skipped_review/`),
      status: 'incorrect_new',
    });
  }

  if (workType === '1000') {
    for (const status of ALL_STATUSES) {
      const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
      prefixes.push({
        folder: withS3Base(`f_${suffix}/`),
        status,
      });
    }
    prefixes.push({ folder: withS3Base('f_skipped_review/'), status: 'incorrect_new' });
    prefixes.push({ folder: withS3Base('correct/'), status: 'correct' });
    prefixes.push({ folder: withS3Base('incorrect/'), status: 'incorrect_new' });
  }

  const seen = new Set();
  return prefixes.filter(({ folder }) => {
    if (seen.has(folder)) return false;
    seen.add(folder);
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

async function collectAllObjectKeysUnderPrefix(s3, prefix) {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const keys = [];
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: normalized,
        ContinuationToken: token,
      }),
    );
    for (const o of out.Contents || []) {
      if (o.Key) keys.push(o.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function countImagesUnderPrefix(s3, prefix) {
  const keys = await collectAllObjectKeysUnderPrefix(s3, prefix);
  return keys.filter((k) => /\.(jpe?g|png|webp)$/i.test(k)).length;
}

async function moveSessionToSimulator(s3, store, sourcePrefix, folderStatus, workType) {
  const targetPrefix = rewritePrefixSource(sourcePrefix, 'simulator');
  if (!targetPrefix || targetPrefix === sourcePrefix) {
    return { ok: false, reason: 'bad_target_prefix' };
  }

  const keys = await collectAllObjectKeysUnderPrefix(s3, sourcePrefix);
  if (keys.length === 0) {
    return { ok: false, reason: 'empty_session' };
  }

  const metaKey = `${sourcePrefix}metadata.json`;
  let metadata;
  try {
    const metaOut = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: metaKey }));
    metadata = JSON.parse(await streamToString(metaOut.Body));
  } catch (e) {
    return { ok: false, reason: `metadata_missing: ${e.message}` };
  }

  if (DRY_RUN) {
    return { ok: true, dryRun: true, sourcePrefix, targetPrefix, sessionId: metadata.session_id };
  }

  for (const key of keys) {
    const relative = key.startsWith(sourcePrefix) ? key.slice(sourcePrefix.length) : key;
    const newKey = `${targetPrefix}${relative}`;
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${key}`,
        Key: newKey,
      }),
    );
  }

  metadata.upload_mode = 'simulator';
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${targetPrefix}metadata.json`,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json; charset=utf-8',
    }),
  );

  for (const key of keys) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }

  if (store && metadata.session_id) {
    const imageCount = await countImagesUnderPrefix(s3, targetPrefix);
    const inferred = inferStatusAndSourceFromSessionPrefix(targetPrefix);
    await store.upsertFromMetadata(metadata, {
      s3Bucket: BUCKET,
      s3SessionPrefix: targetPrefix,
      folderStatus: folderStatus || inferred.status,
      sourceType: 'simulator',
      portalWorkType: workType,
      imageCount,
      ingestSource: 'reclassify_field_to_simulator',
    });
  }

  return { ok: true, sourcePrefix, targetPrefix, sessionId: metadata.session_id };
}

async function reclassifyWorkType(s3, store, workType) {
  const folders = getFieldFolderPrefixes(workType);
  let keepField = 0;
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const { folder, status } of folders) {
    const sessionPrefixes = await listSessionPrefixes(s3, folder);
    console.log(`📂 ${folder} → ${sessionPrefixes.length} sessions`);

    for (const prefix of sessionPrefixes) {
      const metaKey = `${prefix}metadata.json`;
      try {
        const metaOut = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: metaKey }));
        const metadata = JSON.parse(await streamToString(metaOut.Body));

        if (shouldStayField(metadata)) {
          keepField += 1;
          continue;
        }

        const result = await moveSessionToSimulator(s3, store, prefix, status, workType);
        if (result.ok) {
          moved += 1;
          if (moved <= 20 || moved % 25 === 0) {
            console.log(
              `   ${DRY_RUN ? '↪ would move' : '✅ moved'} ${metadata.session_id || prefix}\n      ${prefix} → ${result.targetPrefix}`,
            );
          }
        } else {
          failed += 1;
          console.warn(`   ⚠️ ${metadata.session_id || prefix}: ${result.reason}`);
        }
      } catch (e) {
        skipped += 1;
        console.warn(`   ⚠️ ${metaKey}: ${e.message}`);
      }
    }
  }

  return { keepField, moved, skipped, failed };
}

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🚀 EXECUTE'} — reclassify field → simulator`);
  console.log(`   Bucket: s3://${BUCKET}/`);
  console.log(`   Field window (keep): ${[...FIELD_WINDOW_DAYS].join(', ')} (non-internal collectors only)\n`);

  if (DRY_RUN) {
    console.log('Pass --execute to apply moves.\n');
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

  let store = null;
  if (TABLE) {
    store = createSessionIndexStore({
      tableName: TABLE,
      region: REGION,
      ...(clientConfig.credentials ? { credentials: clientConfig.credentials } : {}),
    });
  } else if (EXECUTE) {
    console.warn('⚠️ AWS_DYNAMODB_SESSIONS_TABLE not set — S3 moves will run but Dynamo index will not update.\n');
  }

  let totalKeep = 0;
  let totalMoved = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const wt of workTypes) {
    console.log(`\n=== Work type ${wt} ===`);
    const stats = await reclassifyWorkType(s3, store, wt);
    totalKeep += stats.keepField;
    totalMoved += stats.moved;
    totalSkipped += stats.skipped;
    totalFailed += stats.failed;
  }

  console.log(
    `\n✅ Done: keep field ${totalKeep}, ${DRY_RUN ? 'would move' : 'moved'} ${totalMoved}, skipped ${totalSkipped}, failed ${totalFailed}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
