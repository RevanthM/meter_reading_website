#!/usr/bin/env node
/**
 * Compare confusion-matrix misreads vs reviewer incorrect_dial_numbers.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client } from '@aws-sdk/client-s3';
import { readFieldTestCycles } from '../server/fieldTestCycles.js';
import { buildFieldTestRollup, filterSessionsForCycle } from '../server/fieldTestAnalytics.js';
import {
  deriveFieldTestFromMetadata,
  incorrectDialNumbersFromItem,
  sessionItemToPerImageRow,
} from '../server/fieldTestDerive.js';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

const workType = process.argv.includes('--work-type')
  ? process.argv[process.argv.indexOf('--work-type') + 1]
  : '1000';

function parseDigit(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (t.length === 1 && t >= '0' && t <= '9') return parseInt(t, 10);
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 && n <= 9 ? n : null;
}

function parseDigitMatch(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return null;
}

function incorrectDialSet(row) {
  const raw = String(row.incorrect_dial_numbers ?? '').trim();
  const out = new Set();
  for (const part of raw.split(/[,;]+/)) {
    const n = parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 4) out.add(n);
  }
  return out;
}

function confusionColLegacy(exp, pred, d, digitMatch) {
  if (digitMatch === true) return exp;
  if (digitMatch === false) return pred != null ? pred : null;
  if (pred != null) {
    if (exp === pred) return exp;
    if (d === 4 && pred < exp) return exp;
    return pred;
  }
  return null;
}

function confusionColReviewer(exp, pred, d, incorrect) {
  if (!incorrect.has(d)) return exp;
  return pred != null ? pred : null;
}

function countMisreads(rows, colFn) {
  let offDiag = 0;
  let total = 0;
  for (const row of rows) {
    const incorrect = incorrectDialSet(row);
    for (let d = 1; d <= 4; d += 1) {
      const exp = parseDigit(row[`dial${d}_expected_digit`]);
      if (exp == null) continue;
      const pred = parseDigit(row[`dial${d}_predicted_digit`]);
      const digitMatch = parseDigitMatch(row[`dial${d}_digit_match`]);
      const col = colFn(exp, pred, d, digitMatch, incorrect);
      if (col == null) continue;
      total += 1;
      if (col !== exp) offDiag += 1;
    }
  }
  return { offDiag, total };
}

async function main() {
  const store = createSessionIndexStore({
    tableName: process.env.AWS_DYNAMODB_SESSIONS_TABLE || 'amr-sessions',
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const bucket = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
  const { cycles } = await readFieldTestCycles(s3, bucket, workType);
  const cycle = cycles[cycles.length - 1];

  const allItems = (await store.queryReadingItems('field', workType)).filter((item) => {
    if (item.field_test_capture === true) return true;
    return String(item.upload_mode || '').trim().toLowerCase() === 'field';
  });

  const items = filterSessionsForCycle(
    allItems.map((item) => {
      const derived = deriveFieldTestFromMetadata({
        upload_mode: item.upload_mode,
        dial_details: item.dial_details,
        final_reading: item.final_reading,
        user_correction: item.user_correction,
        ml_prediction: item.ml_prediction,
        ml_raw_prediction: item.ml_raw_prediction,
        user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
        user_corrected_positions: item.user_corrected_positions,
        image_difficulty: item.image_difficulty,
        dial_count: item.dial_count,
      });
      return { ...item, ...derived };
    }),
    cycle,
  );

  const rollup = buildFieldTestRollup(cycle, items);
  const rows = rollup.perImageRows;

  let reviewerFlaggedDials = 0;
  let capturesWithFlags = 0;
  for (const item of items) {
    const bad = incorrectDialNumbersFromItem(item);
    if (bad.length) capturesWithFlags += 1;
    reviewerFlaggedDials += bad.length;
  }

  const legacy = countMisreads(rows, (exp, pred, d, dm) =>
    confusionColLegacy(exp, pred, d, dm),
  );
  const reviewer = countMisreads(rows, (exp, pred, d, dm, incorrect) =>
    confusionColReviewer(exp, pred, d, incorrect),
  );

  let digitMatchFalse = 0;
  let digitMatchFalseButNotFlagged = 0;
  for (const row of rows) {
    const incorrect = incorrectDialSet(row);
    for (let d = 1; d <= 4; d += 1) {
      if (parseDigitMatch(row[`dial${d}_digit_match`]) === false) {
        digitMatchFalse += 1;
        if (!incorrect.has(d)) digitMatchFalseButNotFlagged += 1;
      }
    }
  }

  const tiers = rollup.imageDifficultyBreakdown || [];
  console.log(`Cycle: ${cycle.name} (${items.length} captures)`);
  console.log(`Reviewer: ${capturesWithFlags} captures, ${reviewerFlaggedDials} flagged dials`);
  console.log(`Rollup accuracy: ${rollup.summary.accuracyPercent}%`);
  console.log(`Difficulty tier confidence: ${tiers.map((t) => `${t.label}=${t.confidencePct ?? '—'}`).join(', ')}`);
  console.log('');
  console.log('Confusion off-diagonal dial cells:');
  console.log(`  Legacy (digit_match): ${legacy.offDiag} / ${legacy.total}`);
  console.log(`  Reviewer-aligned:     ${reviewer.offDiag} / ${reviewer.total}`);
  console.log(`  digit_match=false: ${digitMatchFalse} (${digitMatchFalseButNotFlagged} not in incorrect_dial_numbers)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
