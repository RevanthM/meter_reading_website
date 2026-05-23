#!/usr/bin/env node
/**
 * Backfill pipeline iteration manualMetrics (app accuracy & confidence) from linked unit-test CSVs.
 *
 * Usage (from meter_reading_website/):
 *   node scripts/backfill-iteration-metrics-from-unit-test-csv.mjs
 *   node scripts/backfill-iteration-metrics-from-unit-test-csv.mjs --dry-run
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseUnitTestCsvSummary } from '../server/unitTestCsv.js';
import {
  applyUnitTestDetailToManualMetrics,
  pickNewestUnitTestLink,
} from '../server/unitTestMetricsApply.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

const BUCKET = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
const S3_BASE_PREFIX = (process.env.AWS_S3_BASE_PREFIX || '').trim();
const DRY_RUN = process.argv.includes('--dry-run');

function withS3Base(relativePath) {
  const rel = relativePath.replace(/^\//, '');
  if (!S3_BASE_PREFIX) return rel;
  const base = S3_BASE_PREFIX.replace(/\/+$/, '');
  return `${base}/${rel}`;
}

function pipelineIterationsS3Key() {
  return withS3Base('portal-admin/pipeline-iterations.json');
}

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function streamToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readRegistryDoc() {
  const key = pipelineIterationsS3Key();
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const txt = await streamToString(out.Body);
    return { key, doc: JSON.parse(txt) };
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return { key, doc: { iterations: [] } };
    }
    throw e;
  }
}

async function fetchCsvParsed(s3Key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const csvText = await streamToString(out.Body);
  return parseUnitTestCsvSummary(csvText);
}

function metricsFingerprint(m) {
  if (!m || typeof m !== 'object') return '';
  const keys = [
    'exactReadingAccuracyPct',
    'readAccuracyUt',
    'appAvgKeypointConfidence',
    'appDial1AccuracyPct',
    'appDial2AccuracyPct',
    'appDial3AccuracyPct',
    'appDial4AccuracyPct',
    'appDial1ConfidencePct',
    'appDial2ConfidencePct',
    'appDial3ConfidencePct',
    'appDial4ConfidencePct',
    'dial1UtPct',
    'dial2UtPct',
    'dial3UtPct',
    'dial4UtPct',
    'unitTestImagesLaptop',
  ];
  return keys.map((k) => `${k}:${m[k] ?? ''}`).join('|');
}

async function main() {
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Registry key: ${pipelineIterationsS3Key()}`);
  console.log(DRY_RUN ? 'DRY RUN — no S3 write' : 'LIVE — will write registry to S3');

  const { key: registryKey, doc } = await readRegistryDoc();
  const iterations = Array.isArray(doc.iterations) ? doc.iterations : [];
  let updated = 0;
  let skippedNoLink = 0;
  let skippedUnchanged = 0;
  let failed = 0;

  for (const row of iterations) {
    const links = Array.isArray(row?.linkedUnitTests) ? row.linkedUnitTests : [];
    const link = pickNewestUnitTestLink(links);
    if (!link?.s3Key) {
      skippedNoLink += 1;
      continue;
    }

    const label = `${row.pipeline || '?'} #${row.iterationNumber ?? '?'} (${row.id})`;
    try {
      const parsed = await fetchCsvParsed(link.s3Key);
      const before = metricsFingerprint(row.manualMetrics);
      const { metrics, appliedLabels } = applyUnitTestDetailToManualMetrics(
        parsed.summary,
        parsed.perImageRows,
        row.manualMetrics,
      );
      const after = metricsFingerprint(metrics);
      if (before === after) {
        skippedUnchanged += 1;
        console.log(`  — ${label}: already up to date (${link.fileName || link.s3Key})`);
        continue;
      }
      row.manualMetrics = metrics;
      row.updatedAt = new Date().toISOString();
      updated += 1;
      console.log(
        `  ✓ ${label}: ${appliedLabels.length} fields from ${link.fileName || link.s3Key}`,
      );
    } catch (e) {
      failed += 1;
      console.warn(`  ✗ ${label}: ${e?.message || e}`);
    }
  }

  console.log('');
  console.log(
    `Done: ${updated} updated, ${skippedUnchanged} unchanged, ${skippedNoLink} no CSV link, ${failed} failed (${iterations.length} total)`,
  );

  if (updated === 0) {
    console.log('No registry write needed.');
    return;
  }

  if (DRY_RUN) {
    console.log('Dry run — skipping S3 put.');
    return;
  }

  const nextDoc = {
    ...doc,
    iterations,
    updatedAt: new Date().toISOString(),
    updatedBy: 'backfill-iteration-metrics-from-unit-test-csv.mjs',
  };
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: registryKey,
      Body: JSON.stringify(nextDoc, null, 2),
      ContentType: 'application/json; charset=utf-8',
    }),
  );
  console.log(`Wrote ${registryKey}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
