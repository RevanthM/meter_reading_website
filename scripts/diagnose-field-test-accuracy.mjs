#!/usr/bin/env node
/**
 * Compare field-test accuracy counting methods for a cycle.
 * Usage: node scripts/diagnose-field-test-accuracy.mjs [--work-type 1000] [--cycle-id ID]
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFieldTestCycles } from '../server/fieldTestCycles.js';
import { buildFieldTestRollup, filterSessionsForCycle } from '../server/fieldTestAnalytics.js';
import {
  countReadsCorrectedFromItem,
  filterFieldTestScorableSessions,
  sessionItemToPerImageRow,
  deriveFieldTestFromMetadata,
} from '../server/fieldTestDerive.js';
import { createSessionIndexStore } from '../server/sessionIndex/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

const workType = process.argv.includes('--work-type')
  ? process.argv[process.argv.indexOf('--work-type') + 1]
  : '1000';

function finalReading(item) {
  return String(item.final_reading || item.user_correction || item.ml_prediction || '')
    .replace(/\D/g, '')
    .padStart(4, '0')
    .slice(-4);
}

function mlBaseline(item) {
  const raw = String(item?.ml_raw_prediction ?? item?.ml_prediction ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

function parseMatch(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return null;
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
  if (!store?.enabled) {
    console.error('Dynamo session index not enabled');
    process.exit(1);
  }

  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const bucket = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();

  const { cycles } = await readFieldTestCycles(s3, bucket, workType);
  const cycleId = process.argv.includes('--cycle-id')
    ? process.argv[process.argv.indexOf('--cycle-id') + 1]
    : cycles[cycles.length - 1]?.id;
  const cycle = cycles.find((c) => c.id === cycleId);
  if (!cycle) {
    console.error('Cycle not found', cycleId);
    process.exit(1);
  }

  const allItems = (await store.queryReadingItems('field', workType)).filter((item) => {
    if (item.field_test_capture === true) return true;
    return (
      String(item.upload_mode || '').trim().toLowerCase() === 'field' &&
      String(item.source_type || 'field').toLowerCase() === 'field'
    );
  });

  const inCycle = filterSessionsForCycle(
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
        is_manually_reviewed: item.is_manually_reviewed,
        is_human_reviewed: item.is_human_reviewed,
        feedback_type: item.feedback_type,
        is_correct: item.is_correct,
      });
      return { ...item, ...derived };
    }),
    cycle,
  );
  const items = filterFieldTestScorableSessions(inCycle);

  const rollup = buildFieldTestRollup(cycle, inCycle);

  let byOverallCompare = { correct: 0, incorrect: 0, noGt: 0 };
  let byNoCorrection = { correct: 0, incorrect: 0 };
  let byIsCorrect = { correct: 0, incorrect: 0, unset: 0 };
  let byReadsCorrected = { zero: 0, positive: 0 };
  let byHadCorrection = { yes: 0, no: 0 };
  let mismatchSamples = [];

  for (const item of items) {
    const fin = finalReading(item);
    const ml = mlBaseline(item);
    const row = sessionItemToPerImageRow(item);

    if (fin) {
      const match = parseMatch(row.overall_reading_match);
      const ok =
        match === true ||
        (match !== false && fin === (row.predicted_reading || '').trim());
      if (ok) byOverallCompare.correct += 1;
      else {
        byOverallCompare.incorrect += 1;
        if (mismatchSamples.length < 8) {
          mismatchSamples.push({
            session: item.session_id,
            fin,
            ml,
            rowPred: row.predicted_reading,
            readsCorrected: countReadsCorrectedFromItem(item),
            hadUserCorrection: item.had_user_correction,
            isCorrect: item.is_correct,
            feedback: item.feedback_type,
          });
        }
      }
    } else {
      byOverallCompare.noGt += 1;
    }

    const rc = countReadsCorrectedFromItem(item);
    if (rc === 0) byReadsCorrected.zero += 1;
    else byReadsCorrected.positive += 1;

    if (item.had_user_correction) byHadCorrection.yes += 1;
    else byHadCorrection.no += 1;

    if (rc === 0 && !item.had_user_correction) byNoCorrection.correct += 1;
    else byNoCorrection.incorrect += 1;

    if (item.is_correct === true) byIsCorrect.correct += 1;
    else if (item.is_correct === false) byIsCorrect.incorrect += 1;
    else byIsCorrect.unset += 1;
  }

  console.log(`Cycle: ${cycle.name} (${cycle.id}) ${cycle.startDate} → ${cycle.endDate}`);
  console.log(`Captures in cycle (all): ${inCycle.length}`);
  console.log(`Scorable (correct/incorrect): ${items.length}`);
  console.log(`Excluded from results: ${inCycle.length - items.length}`);
  console.log(`Rollup captureCount: ${rollup.captureCount}`);
  console.log(`Rollup summary: ${rollup.summary.correct}/${rollup.summary.withGroundTruth} full-reading (${rollup.summary.accuracyPercent}%)`);
  console.log(`Rollup readsCorrected total: ${rollup.readsCorrected}`);
  console.log('');
  console.log('Methods:');
  console.log(
    `  Current overall compare: ${byOverallCompare.correct} correct, ${byOverallCompare.incorrect} incorrect (${items.length ? ((100 * byOverallCompare.correct) / (byOverallCompare.correct + byOverallCompare.incorrect)).toFixed(3) : '—'}%)`,
  );
  console.log(
    `  No correction (reads_corrected=0 & !had_user_correction): ${byNoCorrection.correct} correct, ${byNoCorrection.incorrect} incorrect (${items.length ? ((100 * byNoCorrection.correct) / items.length).toFixed(3) : '—'}%)`,
  );
  console.log(`  reads_corrected_count === 0: ${byReadsCorrected.zero} captures`);
  console.log(`  reads_corrected_count > 0: ${byReadsCorrected.positive} captures`);
  console.log(`  had_user_correction: ${byHadCorrection.yes} yes, ${byHadCorrection.no} no`);
  console.log(`  is_correct flag: ${byIsCorrect.correct} true, ${byIsCorrect.incorrect} false, ${byIsCorrect.unset} unset`);
  console.log('');
  console.log('Sample mismatches (overall compare = incorrect):');
  for (const s of mismatchSamples) console.log(' ', JSON.stringify(s));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
