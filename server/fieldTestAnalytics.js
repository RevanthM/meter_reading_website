/**
 * Precomputed field-test cycle rollups on S3 (fast Results tab).
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { captureDayFromIso } from './fieldTestCycles.js';
import { fieldTestCaptureDayKey } from './fieldTestCaptureDay.js';
import {
  captureModelReadingCorrect,
  countReadsCorrectedFromItem,
  filterFieldTestScorableSessions,
  incorrectDialNumbersFromItem,
  sessionItemToPerImageRow,
} from './fieldTestDerive.js';
import { normalizeConfidencePct, roundPortalAccuracyConfidencePct } from './portalMetricFormat.js';

export const FIELD_TEST_ROLLUP_VERSION = 3;
const ROLLUP_VERSION = FIELD_TEST_ROLLUP_VERSION;

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

/** Per-image confidence % for difficulty tiers (session avg, else mean of dial confidences). */
function imageConfidencePctFromRow(row) {
  const sessionConf = normalizeConfidencePct(row.average_confidence);
  const dialConfs = [];
  for (let d = 1; d <= 4; d += 1) {
    const c = normalizeConfidencePct(
      row[`dial${d}_composite_confidence`] ?? row[`dial${d}_confidence`],
    );
    if (c != null) dialConfs.push(c);
  }
  if (dialConfs.length > 0) {
    return roundPortalAccuracyConfidencePct(
      dialConfs.reduce((sum, c) => sum + c, 0) / dialConfs.length,
    );
  }
  return sessionConf;
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
    const conf = imageConfidencePctFromRow(row);
    if (conf != null) bucket.confs.push(conf);
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
        b.withGroundTruth > 0
          ? roundPortalAccuracyConfidencePct((100 * b.correct) / b.withGroundTruth)
          : null,
      confidencePct:
        b.confs.length > 0
          ? roundPortalAccuracyConfidencePct(b.confs.reduce((sum, c) => sum + c, 0) / b.confs.length)
          : null,
    };
  });
}

function countReads(perImageRows, sessionItems = []) {
  let totalReads = 0;
  let readsWithGroundTruth = 0;
  let readsCorrect = 0;
  let readsCorrected = 0;

  for (let i = 0; i < perImageRows.length; i += 1) {
    const row = perImageRows[i];
    const item = sessionItems[i];
    const incorrectDials = item ? new Set(incorrectDialNumbersFromItem(item)) : new Set();
    const corrected = parseInt(row.reads_corrected_count || '0', 10) || 0;
    if (corrected > 0) readsCorrected += corrected;

    for (let d = 1; d <= 4; d++) {
      const exp = row[`dial${d}_expected_digit`];
      if (exp === '' || exp == null) continue;
      totalReads += 1;
      readsWithGroundTruth += 1;
      if (!incorrectDials.has(d)) readsCorrect += 1;
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
  const allInCycle = Array.isArray(sessionItems) ? sessionItems : [];
  const scorableItems = filterFieldTestScorableSessions(allInCycle);
  const perImageRows = scorableItems.map((item) => sessionItemToPerImageRow(item));
  const captureCount = scorableItems.length;
  const readStats = countReads(perImageRows, scorableItems);

  let capturesCorrect = 0;
  let capturesWithGroundTruth = 0;
  const confs = [];

  for (let i = 0; i < perImageRows.length; i += 1) {
    const row = perImageRows[i];
    const item = scorableItems[i];
    const expected = String(row.expected_reading_from_filename || '').trim();
    if (expected) {
      capturesWithGroundTruth += 1;
      if (item ? captureModelReadingCorrect(item) : parseReadingMatch(row.overall_reading_match) === true) {
        capturesCorrect += 1;
      }
    }
    const c = imageConfidencePctFromRow(row);
    if (c != null) confs.push(c);
  }

  const accuracyPercent =
    capturesWithGroundTruth > 0
      ? roundPortalAccuracyConfidencePct((100 * capturesCorrect) / capturesWithGroundTruth)
      : null;
  const averageConfidencePct =
    confs.length > 0
      ? roundPortalAccuracyConfidencePct(confs.reduce((a, b) => a + b, 0) / confs.length)
      : null;

  const correctionPct =
    readStats.totalReads > 0
      ? roundPortalAccuracyConfidencePct((100 * readStats.readsCorrected) / readStats.totalReads)
      : null;

  return {
    version: ROLLUP_VERSION,
    cycleId: cycle.id,
    cycleName: cycle.name,
    workType: cycle.workType,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    builtAt: new Date().toISOString(),
    cycleCaptureCount: allInCycle.length,
    excludedFromResultsCount: Math.max(0, allInCycle.length - scorableItems.length),
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

/** Portal reading rows (list endpoint — uses dateOfReading). */
export function filterReadingsForCycle(readings, cycle) {
  if (!cycle) return readings;
  return readings.filter((r) => {
    const day = fieldTestCaptureDayKey(r.dateOfReading || r.date || r.createdAt);
    if (!day) return false;
    return day >= cycle.startDate && day <= cycle.endDate;
  });
}
