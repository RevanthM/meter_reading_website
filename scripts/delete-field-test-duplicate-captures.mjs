#!/usr/bin/env node
/**
 * Delete duplicate field test captures (same user + model reading + ground truth + Pacific day).
 * Keeps the earliest capture in each group; removes S3 folder + Dynamo row for the rest.
 *
 * Usage:
 *   AWS_PROFILE=amr node scripts/delete-field-test-duplicate-captures.mjs --dry-run
 *   AWS_PROFILE=amr node scripts/delete-field-test-duplicate-captures.mjs --execute
 *   ... --user "ravi vaddi"   # optional filter
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';
import {
  finalReadingFromMetadata,
  isFieldTestPortalCapture,
} from '../server/fieldTestDerive.js';
import { calendarDayKeyInPortalTz } from '../server/improvementAnalytics.js';
import { invalidateFieldTestRollupsForCaptureDate } from '../server/fieldTestAnalytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

if (process.env.AWS_PROFILE) {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
}

const EXECUTE = process.argv.includes('--execute');
const userFilter = (() => {
  const i = process.argv.indexOf('--user');
  return i >= 0 ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';
})();
const BUCKET = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
const TABLE = (process.env.AWS_DYNAMODB_SESSIONS_TABLE || 'amr-sessions').trim();
const WORK_TYPE = process.argv.includes('--work-type')
  ? process.argv[process.argv.indexOf('--work-type') + 1]
  : '1000';

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function pad4(v) {
  const raw = String(v ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}
function modelReading(item) {
  return pad4(item.ml_raw_prediction ?? item.ml_prediction);
}
function groundMeta(item) {
  return {
    final_reading: item.final_reading,
    user_correction: item.user_correction,
    ml_prediction: item.ml_prediction,
    ml_raw_prediction: item.ml_raw_prediction,
    feedback_type: item.feedback_type,
    is_correct: item.is_correct,
    portal_manual_review_status: item.portal_manual_review_status,
    portal_metadata_updated_by: item.portal_metadata_updated_by,
  };
}

async function listKeysUnderPrefix(s3, prefix) {
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const keys = [];
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p, ContinuationToken: token }),
    );
    for (const obj of out.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteS3Prefix(s3, prefix) {
  const keys = await listKeysUnderPrefix(s3, prefix);
  if (keys.length === 0) return 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  return keys.length;
}

async function deleteDynamoRow(dynamo, sessionId) {
  await dynamo.send(
    new DeleteItemCommand({
      TableName: TABLE,
      Key: marshall({ session_id: sessionId }),
    }),
  );
}

async function main() {
  const store = createSessionIndexStore({ tableName: TABLE, region: REGION });
  if (!store.enabled) {
    console.error('Dynamo session index not enabled');
    process.exit(1);
  }

  const s3 = new S3Client({ region: REGION });
  const dynamo = new DynamoDBClient({ region: REGION });

  const items = (await store.queryReadingItems('field', WORK_TYPE)).filter(isFieldTestPortalCapture);
  let scoped = items;
  if (userFilter) {
    scoped = items.filter((it) => normName(it.user_name || it.user_email).includes(userFilter));
  }

  const groups = new Map();
  for (const it of scoped) {
    const user = normName(it.user_name || it.user_email);
    if (!user) continue;
    const model = modelReading(it);
    const truth = pad4(finalReadingFromMetadata(groundMeta(it)));
    const day = calendarDayKeyInPortalTz(it.captured_at || '');
    if (!model || !truth || !day) continue;
    const key = [user, model, truth, day].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  /** @type {object[]} */
  const toDelete = [];
  for (const [, arr] of groups) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => String(a.captured_at || '').localeCompare(String(b.captured_at || '')));
    const [keep, ...extras] = arr;
    for (const it of extras) {
      toDelete.push({ item: it, keepId: keep.session_id, groupSize: arr.length });
    }
  }

  toDelete.sort((a, b) => String(a.item.captured_at).localeCompare(String(b.item.captured_at)));

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Field captures scanned: ${scoped.length}`);
  console.log(`Duplicate sessions to delete: ${toDelete.length}`);
  console.log(`Groups affected: ${new Set(toDelete.map((d) => d.keepId)).size}`);

  const byUser = new Map();
  for (const row of toDelete) {
    const u = row.item.user_name || row.item.user_email || '?';
    byUser.set(u, (byUser.get(u) || 0) + 1);
  }
  console.log('\nBy user:');
  for (const [u, n] of [...byUser.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${u}`);
  }

  console.log('\nSample deletions (first 15):');
  for (const row of toDelete.slice(0, 15)) {
    const it = row.item;
    console.log(
      `  DELETE ${it.session_id}  keep=${row.keepId}  ${normName(it.user_name)}  model=${modelReading(it)}  day=${calendarDayKeyInPortalTz(it.captured_at)}  (${row.groupSize}x)`,
    );
  }

  if (!EXECUTE) {
    console.log('\nRe-run with --execute to delete S3 + Dynamo rows.');
    return;
  }

  let s3Objects = 0;
  let dynamoRows = 0;
  const rollupDays = new Set();

  for (const row of toDelete) {
    const it = row.item;
    const prefix = it.s3_session_prefix;
    if (!prefix) {
      console.warn('  skip (no prefix):', it.session_id);
      continue;
    }
    try {
      const n = await deleteS3Prefix(s3, prefix);
      s3Objects += n;
      await deleteDynamoRow(dynamo, it.session_id);
      dynamoRows += 1;
      const day = calendarDayKeyInPortalTz(it.captured_at || '');
      if (day) rollupDays.add(day);
      console.log(`  deleted ${it.session_id} (${n} S3 objects)`);
    } catch (e) {
      console.error(`  FAILED ${it.session_id}:`, e?.message || e);
    }
  }

  for (const day of rollupDays) {
    await invalidateFieldTestRollupsForCaptureDate(s3, BUCKET, WORK_TYPE, `${day}T12:00:00.000Z`);
  }

  console.log(`\nDone. Dynamo rows deleted: ${dynamoRows}, S3 objects deleted: ${s3Objects}`);
  console.log('Field test cycle rollups invalidated for affected days — refresh Results in portal.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
