#!/usr/bin/env node
/**
 * One-shot: read unit test manifest per work type (migrates legacy XLSX → JSON if needed).
 *
 * Usage (from meter_reading_website/):
 *   node scripts/migrate-unit-test-manifest-to-json.mjs
 *   node scripts/migrate-unit-test-manifest-to-json.mjs --work-type 1000
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  readUnitTestManifestRows,
  unitTestManifestKey,
  unitTestManifestLegacyXlsxKey,
} from '../server/unitTestManifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

const WORK_TYPES = ['1000', '2000', '3000', '4000', '5000'];
const BUCKET = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function headKey(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

async function migrateWorkType(workType) {
  const jsonKey = unitTestManifestKey(workType);
  const xlsxKey = unitTestManifestLegacyXlsxKey(workType);
  const hadJsonBefore = await headKey(jsonKey);
  const hadXlsx = await headKey(xlsxKey);

  const { key, rows } = await readUnitTestManifestRows(s3, BUCKET, workType);
  const hasJsonAfter = await headKey(jsonKey);

  return {
    workType,
    rows: rows.length,
    key,
    hadJsonBefore,
    hadXlsx,
    hasJsonAfter,
    migrated: !hadJsonBefore && hadXlsx && hasJsonAfter,
  };
}

async function main() {
  const wtArg = process.argv.find((a) => a.startsWith('--work-type='));
  const wtFlag = process.argv.indexOf('--work-type');
  let workTypes = WORK_TYPES;
  if (wtArg) {
    workTypes = [wtArg.split('=')[1]];
  } else if (wtFlag >= 0 && process.argv[wtFlag + 1]) {
    workTypes = [process.argv[wtFlag + 1]];
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or use .env in repo root / src/.env).');
    process.exit(1);
  }

  console.log(`Bucket: ${BUCKET} (${REGION})`);
  for (const workType of workTypes) {
    const r = await migrateWorkType(workType);
    const status = r.migrated
      ? `migrated ${r.rows} row(s) from XLSX → JSON`
      : r.hadJsonBefore
        ? `JSON already present (${r.rows} row(s))`
        : r.rows > 0
          ? `wrote JSON (${r.rows} row(s))`
          : 'no manifest (empty)';
    console.log(`  ${workType}: ${status} → ${r.key}`);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
