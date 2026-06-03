#!/usr/bin/env node
/**
 * Find field-test scorable sessions where the OLD ground-truth reading
 * (final_reading ?? user_correction ?? ml_prediction) disagrees with the NEW
 * rule when there are no dial corrections (final_reading ?? ml_raw ?? user_correction …).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSessionIndexStore } from '../server/sessionIndex/dynamoStore.js';
import {
  countReadsCorrectedFromItem,
  filterFieldTestScorableSessions,
  isFieldTestScorableCapture,
  sessionItemToPerImageRow,
} from '../server/fieldTestDerive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

function oldFinalReadingFromMetadata(metadata) {
  const raw = String(
    metadata.final_reading ?? metadata.user_correction ?? metadata.ml_prediction ?? '',
  ).replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

function newFinalReadingFromMetadata(metadata) {
  const hadDialCorrections = countReadsCorrectedFromItem(metadata) > 0;
  const candidates = hadDialCorrections
    ? [
        metadata?.final_reading,
        metadata?.user_correction,
        metadata?.ml_raw_prediction,
        metadata?.ml_prediction,
      ]
    : [
        metadata?.final_reading,
        metadata?.ml_raw_prediction,
        metadata?.user_correction,
        metadata?.ml_prediction,
      ];
  const picked = candidates.find((v) => v != null && String(v).trim() !== '');
  const raw = String(picked ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

function dialDigitsFromReading(reading) {
  const r = String(reading || '').padStart(4, '0').slice(-4);
  return [0, 1, 2, 3].map((i) => (/\d/.test(r[i]) ? parseInt(r[i], 10) : null));
}

function itemToMeta(item) {
  return {
    final_reading: item.final_reading,
    user_correction: item.user_correction,
    ml_prediction: item.ml_prediction,
    ml_raw_prediction: item.ml_raw_prediction,
    user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
    user_corrected_positions: item.user_corrected_positions,
    reads_corrected_count: item.reads_corrected_count,
  };
}

async function main() {
  const tableName = (process.env.AWS_DYNAMODB_SESSIONS_TABLE || 'amr-sessions').trim();
  if (!tableName) {
    console.error('AWS_DYNAMODB_SESSIONS_TABLE not set');
    process.exit(1);
  }

  const store = createSessionIndexStore({
    tableName,
    region: process.env.AWS_REGION || 'us-east-1',
  });

  if (!store.enabled) {
    console.error('Dynamo session index disabled');
    process.exit(1);
  }

  console.log('Scanning field captures (work type 1000)…\n');

  const items = await store.queryReadingItems('field', '1000');
  const fieldUploads = items.filter(
    (it) => String(it.upload_mode || '').toLowerCase() === 'field' || it.field_test_capture === true,
  );
  const scorable = filterFieldTestScorableSessions(fieldUploads);

  let mismatchCount = 0;
  let missingFinalOnly = 0;
  let dialLevelMismatch = 0;
  /** @type {object[]} */
  const samples = [];

  for (const item of scorable) {
    const meta = itemToMeta(item);
    const oldR = oldFinalReadingFromMetadata(meta);
    const newR = newFinalReadingFromMetadata(meta);
    if (oldR === newR) continue;

    const hadDialCorrections = countReadsCorrectedFromItem(meta) > 0;
    const noFinal = !String(item.final_reading || '').trim();
    const hasRaw = Boolean(String(item.ml_raw_prediction || '').trim());
    const hasUc = Boolean(String(item.user_correction || '').trim());

    mismatchCount += 1;
    if (!hadDialCorrections && noFinal && hasRaw && hasUc) missingFinalOnly += 1;

    const oldDials = dialDigitsFromReading(oldR);
    const newDials = dialDigitsFromReading(newR);
    const dialDiffs = [];
    for (let d = 0; d < 4; d += 1) {
      if (oldDials[d] !== newDials[d]) dialDiffs.push({ dial: d + 1, was: oldDials[d], now: newDials[d] });
    }
    if (dialDiffs.length > 0) dialLevelMismatch += 1;

    if (samples.length < 25) {
      samples.push({
        session_id: item.session_id,
        captured_at: item.captured_at,
        folder_status: item.folder_status,
        final_reading: item.final_reading ?? null,
        ml_raw: item.ml_raw_prediction ?? null,
        user_correction: item.user_correction ?? null,
        old_reading: oldR,
        new_reading: newR,
        dial_diffs: dialDiffs,
        had_dial_corrections: hadDialCorrections,
      });
    }
  }

  // Also count scorable with missing final_reading (whether or not reading strings differ)
  const missingFinalScorable = scorable.filter((it) => !String(it.final_reading || '').trim()).length;

  console.log('Totals (meter reading / work type 1000, field uploads)');
  console.log(`  Dynamo field items:        ${fieldUploads.length}`);
  console.log(`  Field-test scorable:       ${scorable.length}`);
  console.log(`  Missing final_reading:     ${missingFinalScorable}`);
  console.log(`  Old vs new reading differ: ${mismatchCount}`);
  console.log(`  └ no dial fixes + no final + has raw+uc: ${missingFinalOnly}`);
  console.log(`  └ at least one dial digit changes:     ${dialLevelMismatch}`);
  console.log('');

  if (samples.length > 0) {
    console.log(`Sample sessions (up to ${samples.length}):`);
    for (const s of samples) {
      console.log(`  ${s.session_id}`);
      console.log(
        `    final=${s.final_reading ?? '—'} raw=${s.ml_raw} uc=${s.user_correction} → ${s.old_reading} → ${s.new_reading}`,
      );
      if (s.dial_diffs.length) {
        console.log(`    dial changes: ${s.dial_diffs.map((d) => `d${d.dial}:${d.was}→${d.now}`).join(', ')}`);
      }
    }
  }

  // Spot-check: confusion row for first mismatch using current server helper
  if (mismatchCount > 0 && samples[0]) {
    const hit = scorable.find((it) => it.session_id === samples[0].session_id);
    if (hit) {
      const row = sessionItemToPerImageRow(hit);
      console.log('\nSpot-check (fixed row builder) for first sample:');
      for (let d = 1; d <= 4; d += 1) {
        console.log(`  d${d} exp=${row[`dial${d}_expected_digit`]} pred=${row[`dial${d}_predicted_digit`]}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
