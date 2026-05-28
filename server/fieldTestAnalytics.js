/**
 * Precomputed field-test cycle rollups on S3 (fast Results tab).
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { captureDayFromIso } from './fieldTestCycles.js';
import { countReadsCorrectedFromItem, sessionItemToPerImageRow } from './fieldTestDerive.js';

const ROLLUP_VERSION = 1;

export function fieldTestRollupKey(workType, cycleId) {
  const wt = String(workType || '1000').trim() || '1000';
  const id = String(cycleId || '').trim();
  return `${wt}/field_test_cycles/${id}/analytics_v${ROLLUP_VERSION}.json`;
}

function parseReadingMatch(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return null;
}

function difficultyStatsFromRows(perImageRows) {
  const tiers = [
    { code: 'd1', label: 'Normal' },
    { code: 'd2', label: 'Difficult' },
    { code: 'd3', label: 'Very difficult' },
  ];
  const buckets = new Map(
    tiers.map((t) => [t.code, { ...t, imageCount: 0, withGroundTruth: 0, correct: 0, confs: [] }]),
  );

  for (const row of perImageRows) {
    const code = String(row.image_difficulty_code || 'd1').toLowerCase();
    const bucket = buckets.get(code) || buckets.get('d1');
    if (!bucket) continue;
    bucket.imageCount += 1;
    const match = parseReadingMatch(row.overall_reading_match);
    const expected = String(row.expected_reading_from_filename || '').trim();
    if (expected) {
      bucket.withGroundTruth += 1;
      if (match === true) bucket.correct += 1;
      else if (match === false) {
        /* incorrect */
      } else if (
        (row.predicted_reading || '').trim() &&
        expected === (row.predicted_reading || '').trim()
      ) {
        bucket.correct += 1;
      }
    }
    const conf = parseFloat(row.average_confidence);
    if (Number.isFinite(conf)) {
      const pct = conf <= 1 && conf >= 0 ? conf * 100 : conf;
      bucket.confs.push(pct);
    }
  }

  return tiers.map(({ code, label }) => {
    const b = buckets.get(code);
    if (!b) {
      return { code, label, imageCount: 0, withGroundTruth: 0, correct: 0, accuracyPct: null, confidencePct: null };
    }
    return {
      code,
      label,
      imageCount: b.imageCount,
      withGroundTruth: b.withGroundTruth,
      correct: b.correct,
      accuracyPct:
        b.withGroundTruth > 0 ? Math.round((1000 * b.correct) / b.withGroundTruth) / 10 : null,
      confidencePct:
        b.confs.length > 0
          ? Math.round((b.confs.reduce((a, c) => a + c, 0) / b.confs.length) * 10) / 10
          : null,
    };
  });
}

function countReads(perImageRows, sessionItems = []) {
  let totalReads = 0;
  let readsWithGroundTruth = 0;
  let readsCorrect = 0;
  let readsCorrected = 0;

  for (const row of perImageRows) {
    const corrected = parseInt(row.reads_corrected_count || '0', 10) || 0;
    if (corrected > 0) readsCorrected += corrected;

    for (let d = 1; d <= 4; d++) {
      const exp = row[`dial${d}_expected_digit`];
      if (exp === '' || exp == null) continue;
      totalReads += 1;
      readsWithGroundTruth += 1;
      const match = parseReadingMatch(row[`dial${d}_digit_match`]);
      if (match === true) readsCorrect += 1;
    }
  }

  if (readsCorrected === 0 && sessionItems.length > 0) {
    readsCorrected = sessionItems.reduce((sum, item) => sum + countReadsCorrectedFromItem(item), 0);
  }

  return { totalReads, readsWithGroundTruth, readsCorrect, readsCorrected };
}

/**
 * @param {object} cycle
 * @param {object[]} sessionItems — Dynamo items (field captures)
 */
export function buildFieldTestRollup(cycle, sessionItems) {
  const perImageRows = sessionItems.map((item) => sessionItemToPerImageRow(item));
  const captureCount = sessionItems.length;
  const readStats = countReads(perImageRows, sessionItems);

  let capturesCorrect = 0;
  let capturesWithGroundTruth = 0;
  const confs = [];

  for (const row of perImageRows) {
    const expected = String(row.expected_reading_from_filename || '').trim();
    if (expected) {
      capturesWithGroundTruth += 1;
      const match = parseReadingMatch(row.overall_reading_match);
      if (match === true) capturesCorrect += 1;
      else if (match !== false && (row.predicted_reading || '').trim() === expected) {
        capturesCorrect += 1;
      }
    }
    const c = parseFloat(row.average_confidence);
    if (Number.isFinite(c)) confs.push(c <= 1 ? c * 100 : c);
  }

  const accuracyPercent =
    capturesWithGroundTruth > 0
      ? Math.round((1000 * capturesCorrect) / capturesWithGroundTruth) / 10
      : null;
  const averageConfidencePct =
    confs.length > 0
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10
      : null;

  const correctionPct =
    readStats.totalReads > 0
      ? Math.round((1000 * readStats.readsCorrected) / readStats.totalReads) / 10
      : null;

  return {
    version: ROLLUP_VERSION,
    cycleId: cycle.id,
    cycleName: cycle.name,
    workType: cycle.workType,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    builtAt: new Date().toISOString(),
    captureCount,
    totalReads: readStats.totalReads,
    readsWithGroundTruth: readStats.readsWithGroundTruth,
    readsCorrect: readStats.readsCorrect,
    readsCorrected: readStats.readsCorrected,
    correctionPct,
    summary: {
      imagesProcessed: captureCount,
      withGroundTruth: capturesWithGroundTruth,
      correct: capturesCorrect,
      accuracyPercent,
      average_confidence:
        confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length / 100 : null,
    },
    imageDifficultyBreakdown: difficultyStatsFromRows(perImageRows),
    perImageRows,
    perImageCount: perImageRows.length,
  };
}

export async function readFieldTestRollup(s3Client, bucket, workType, cycleId) {
  const key = fieldTestRollupKey(workType, cycleId);
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await out.Body.transformToString();
    return { key, rollup: JSON.parse(text) };
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return { key, rollup: null };
    }
    throw e;
  }
}

export async function writeFieldTestRollup(s3Client, bucket, workType, cycleId, rollup) {
  const key = fieldTestRollupKey(workType, cycleId);
  const body = JSON.stringify(rollup, null, 2);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
    }),
  );
  return key;
}

export function filterSessionsForCycle(sessions, cycle) {
  if (!cycle) return sessions;
  return sessions.filter((s) => {
    const day = captureDayFromIso(s.captured_at || s.capturedAt);
    if (!day) return false;
    return day >= cycle.startDate && day <= cycle.endDate;
  });
}
