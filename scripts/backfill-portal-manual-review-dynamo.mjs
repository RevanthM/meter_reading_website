#!/usr/bin/env node
/**
 * Backfill portal manual review fields from S3 metadata.json into DynamoDB.
 *
 * The session-sync lambda was missing portal_manual_review_* mapping, so saves
 * persisted in S3 but were wiped from the Dynamo list index on the next sync.
 *
 * Usage:
 *   AWS_PROFILE=amr AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions node scripts/backfill-portal-manual-review-dynamo.mjs
 *   ... --dry-run
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';
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
const DRY_RUN = process.argv.includes('--dry-run');

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function hasPortalManualReview(metadata) {
  const status = String(metadata?.portal_manual_review_status || '').trim().toLowerCase();
  if (status === 'correct' || status === 'incorrect') return true;
  const notes = metadata?.portal_manual_review_notes;
  return notes != null && String(notes).trim() !== '';
}

async function scanFieldSessions(dynamo) {
  /** @type {object[]} */
  const items = [];
  let exclusiveStartKey;
  do {
    const out = await dynamo.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'upload_mode = :field',
        ExpressionAttributeValues: { ':field': { S: 'field' } },
        ProjectionExpression:
          'session_id, s3_session_prefix, s3_bucket, portal_work_type, folder_status, source_type, upload_mode',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const row of out.Items || []) {
      items.push(unmarshall(row));
    }
    exclusiveStartKey = out.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function main() {
  if (!TABLE) {
    console.error('Set AWS_DYNAMODB_SESSIONS_TABLE (e.g. amr-sessions)');
    process.exit(1);
  }

  const clientConfig = { region: REGION };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  const s3 = new S3Client(clientConfig);
  const dynamo = new DynamoDBClient(clientConfig);
  const store = createSessionIndexStore({
    tableName: TABLE,
    region: REGION,
    ...(clientConfig.credentials ? { credentials: clientConfig.credentials } : {}),
  });

  console.log(
    `\n🔄 Backfill portal manual review → DynamoDB ${TABLE}${DRY_RUN ? ' (dry run)' : ''}\n`,
  );

  const rows = await scanFieldSessions(dynamo);
  console.log(`Scanned ${rows.length} field upload rows`);

  let candidates = 0;
  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const sessionId = String(row.session_id || '').trim();
    const prefix = String(row.s3_session_prefix || '').trim();
    if (!sessionId || !prefix) {
      skipped += 1;
      continue;
    }

    const bucket = String(row.s3_bucket || BUCKET).trim() || BUCKET;
    const metaKey = `${prefix.endsWith('/') ? prefix : `${prefix}/`}metadata.json`;

    try {
      const metaOut = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: metaKey }));
      const metadata = JSON.parse(await streamToString(metaOut.Body));
      if (!hasPortalManualReview(metadata)) {
        skipped += 1;
        continue;
      }

      candidates += 1;
      const inferred = inferStatusAndSourceFromSessionPrefix(prefix);
      const ctx = {
        s3Bucket: bucket,
        s3SessionPrefix: prefix,
        folderStatus: row.folder_status || inferred.status,
        sourceType: row.source_type || inferred.sourceType,
        portalWorkType: row.portal_work_type || metadata.work_type || '1000',
        metadataEtag: metaOut.ETag,
        ingestSource: 'portal_manual_review_backfill',
      };

      console.log(
        `  ${sessionId} → ${metadata.portal_manual_review_status || 'notes-only'} ${
          metadata.portal_manual_review_notes ? `"${String(metadata.portal_manual_review_notes).slice(0, 40)}"` : ''
        }`,
      );

      if (!DRY_RUN) {
        await store.upsertFromMetadata(metadata, ctx);
        upserted += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`  ⚠️ ${sessionId} (${metaKey}): ${e.message}`);
    }
  }

  console.log(
    `\n✅ Done: ${candidates} with portal manual review in S3, ${upserted} upserted, ${skipped} skipped, ${failed} failed\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
