/**
 * Apply iOS unit-test CSV metrics onto pipeline iteration manualMetrics (app accuracy & confidence).
 */

export function normalizeConfidencePct(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
}

function parseDigit(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (t.length === 1 && t >= '0' && t <= '9') return parseInt(t, 10);
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 9) return n;
  return null;
}

function parseDigitMatch(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  return null;
}

function dialDigitMatches(expected, predicted, dialNumber) {
  if (expected === predicted) return true;
  if (dialNumber === 4 && predicted < expected) return true;
  return false;
}

function resolvePredictedDigit(row, dial) {
  for (const key of [
    `dial${dial}_predicted_digit`,
    `dial${dial}_finalDigit`,
    `dial${dial}_final_digit`,
    `dial${dial}_stage3_final_digit`,
    `dial${dial}_floorDigit`,
    `dial${dial}_nearestDigit`,
  ]) {
    const digit = parseDigit(row[key]);
    if (digit != null) return digit;
  }
  return null;
}

/** @param {Record<string, string | number | null | undefined>} summary */
export function dialStatsFromCsvSummary(summary) {
  const out = [];
  for (let d = 1; d <= 4; d += 1) {
    const withGroundTruth = parseInt(String(summary[`dial${d}_with_ground_truth`] ?? ''), 10) || 0;
    const correct = parseInt(String(summary[`dial${d}_correct`] ?? ''), 10) || 0;
    const accRaw = summary[`dial${d}_accuracy_percent`];
    let accuracyPct = null;
    if (accRaw != null && accRaw !== '') {
      const v = parseFloat(String(accRaw));
      if (Number.isFinite(v)) accuracyPct = Math.round(v * 10) / 10;
    } else if (withGroundTruth > 0) {
      accuracyPct = Math.round((1000 * correct) / withGroundTruth) / 10;
    }
    out.push({
      dial: d,
      withGroundTruth,
      correct,
      accuracyPct,
      confidencePct: normalizeConfidencePct(summary[`dial${d}_average_confidence`]),
    });
  }
  return out;
}

/** @param {Record<string, string>[]} rows */
export function dialStatsFromPerImageRows(rows) {
  const out = [];
  for (let d = 1; d <= 4; d += 1) {
    let withGroundTruth = 0;
    let correct = 0;
    const confs = [];
    for (const row of rows) {
      const exp = parseDigit(row[`dial${d}_expected_digit`]);
      if (exp == null) continue;
      const pred = resolvePredictedDigit(row, d);
      const digitMatch = parseDigitMatch(row[`dial${d}_digit_match`]);
      withGroundTruth += 1;
      if (digitMatch === true) {
        correct += 1;
      } else if (
        digitMatch !== false &&
        pred != null &&
        dialDigitMatches(exp, pred, d)
      ) {
        correct += 1;
      }
      const conf = normalizeConfidencePct(
        row[`dial${d}_composite_confidence`] ?? row[`dial${d}_stage2_kp_model_confidence`],
      );
      if (conf != null) confs.push(conf);
    }
    out.push({
      dial: d,
      withGroundTruth,
      correct,
      accuracyPct:
        withGroundTruth > 0 ? Math.round((1000 * correct) / withGroundTruth) / 10 : null,
      confidencePct:
        confs.length > 0
          ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10
          : null,
    });
  }
  return out;
}

/** @param {{ summary: Record<string, unknown>; perImageRows?: Record<string, string>[] }} detail */
export function resolveDialStats(detail) {
  const fromSummary = dialStatsFromCsvSummary(detail.summary);
  if (fromSummary.some((d) => d.withGroundTruth > 0)) return fromSummary;
  if (detail.perImageRows?.length) return dialStatsFromPerImageRows(detail.perImageRows);
  return fromSummary;
}

/**
 * @param {Record<string, unknown>} summary
 * @param {Record<string, string>[] | null | undefined} perImageRows
 * @param {Record<string, unknown> | null | undefined} existing
 */
export function applyUnitTestDetailToManualMetrics(summary, perImageRows, existing) {
  const next = { ...(existing ?? {}) };
  const appliedLabels = [];

  const acc = summary.accuracyPercent;
  if (acc != null && Number.isFinite(Number(acc))) {
    next.exactReadingAccuracyPct = Number(acc);
    next.readAccuracyUt = Number(acc);
    appliedLabels.push('Exact reading accuracy', 'Read acc. UT');
  }

  const n = summary.imagesProcessed;
  if (n != null && Number.isFinite(Number(n)) && Number(n) > 0) {
    next.unitTestImagesLaptop = Number(n);
    appliedLabels.push('UT images (laptop)');
  }

  const runConf = normalizeConfidencePct(summary.average_confidence);
  if (runConf != null) {
    next.appAvgKeypointConfidence = runConf;
    appliedLabels.push('App avg keypoint confidence');
  }

  const dialStats = resolveDialStats({ summary, perImageRows: perImageRows ?? undefined });
  const appAccKeys = [
    'appDial1AccuracyPct',
    'appDial2AccuracyPct',
    'appDial3AccuracyPct',
    'appDial4AccuracyPct',
  ];
  const appConfKeys = [
    'appDial1ConfidencePct',
    'appDial2ConfidencePct',
    'appDial3ConfidencePct',
    'appDial4ConfidencePct',
  ];
  const utKeys = ['dial1UtPct', 'dial2UtPct', 'dial3UtPct', 'dial4UtPct'];

  for (const stat of dialStats) {
    const idx = stat.dial - 1;
    if (idx < 0 || idx > 3) continue;
    if (stat.accuracyPct != null) {
      next[appAccKeys[idx]] = stat.accuracyPct;
      next[utKeys[idx]] = stat.accuracyPct;
      appliedLabels.push(`Dial ${stat.dial} app accuracy`);
    }
    if (stat.confidencePct != null) {
      next[appConfKeys[idx]] = stat.confidencePct;
      appliedLabels.push(`Dial ${stat.dial} app confidence`);
    }
  }

  return { metrics: next, appliedLabels };
}

/** @param {Array<{ generatedUtc?: string | null; linkedAt?: string | null }>} links */
export function pickNewestUnitTestLink(links) {
  if (!links?.length) return null;
  return [...links].sort((a, b) => {
    const ta = Date.parse(a.generatedUtc || a.linkedAt || '') || 0;
    const tb = Date.parse(b.generatedUtc || b.linkedAt || '') || 0;
    return tb - ta;
  })[0];
}
