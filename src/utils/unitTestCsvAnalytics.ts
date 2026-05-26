import type {
  UnitTestCsvSummary,
  UnitTestImageDifficultyTier,
  UnitTestRunDetailResponse,
} from '../services/api';
import { difficultyToCode } from './unitTestImageNaming';

export type RunPerformance = {
  accuracyPct: number | null;
  withGroundTruth: number;
  correct: number;
  incorrect: number;
};

export type ConfidenceHistogramBin = {
  label: string;
  min: number;
  max: number;
  count: number;
};

export type UnitTestDialStats = {
  dial: number;
  withGroundTruth: number;
  correct: number;
  accuracyPct: number | null;
  /** 0–100 display */
  confidencePct: number | null;
};

export type UnitTestImageDifficultyTierStats = UnitTestImageDifficultyTier;

const DIFFICULTY_TIER_ORDER: { code: 'd1' | 'd2' | 'd3'; label: string }[] = [
  { code: 'd1', label: 'Normal' },
  { code: 'd2', label: 'Difficult' },
  { code: 'd3', label: 'Very difficult' },
];

function parseReadingMatch(raw: string | undefined): boolean | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  return null;
}

/** From server-parsed IMAGE_DIFFICULTY_BREAKDOWN (preferred). */
export function difficultyStatsFromBreakdown(
  tiers: UnitTestImageDifficultyTier[] | undefined,
): UnitTestImageDifficultyTierStats[] {
  if (!tiers?.length) return [];
  return tiers.filter((t) => t.imageCount > 0 || t.withGroundTruth > 0);
}

/** Recompute when CSV summary block is missing but per-image rows exist. */
export function difficultyStatsFromPerImageRows(
  rows: Record<string, string>[],
): UnitTestImageDifficultyTierStats[] {
  type Bucket = { imageCount: number; withGroundTruth: number; correct: number; confs: number[] };
  const buckets = new Map<'d1' | 'd2' | 'd3', Bucket>();
  for (const { code } of DIFFICULTY_TIER_ORDER) {
    buckets.set(code, { imageCount: 0, withGroundTruth: 0, correct: 0, confs: [] });
  }

  for (const row of rows) {
    const code =
      (row.image_difficulty_code?.trim().toLowerCase() as 'd1' | 'd2' | 'd3' | '') ||
      difficultyToCode(row.image_difficulty);
    const bucket = buckets.get(code);
    if (!bucket) continue;
    bucket.imageCount += 1;
    const expected = (row.expected_reading_from_filename ?? '').trim();
    if (expected) {
      bucket.withGroundTruth += 1;
      const match = parseReadingMatch(row.overall_reading_match);
      if (match === true) bucket.correct += 1;
      else if (match === false) {
        /* counted as incorrect */
      } else if (
        (row.predicted_reading ?? '').trim() &&
        expected === (row.predicted_reading ?? '').trim()
      ) {
        bucket.correct += 1;
      }
    }
    const conf = normalizeConfidencePct(row.average_confidence);
    if (conf != null) bucket.confs.push(conf);
  }

  return DIFFICULTY_TIER_ORDER.map(({ code, label }) => {
    const b = buckets.get(code)!;
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
  }).filter((t) => t.imageCount > 0);
}

export type DigitConfusionMatrix = {
  /** matrix[expected][predicted] for digits 0–9 */
  matrix: number[][];
  total: number;
  digits: string[];
};

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

function parseDigit(raw: string | undefined): number | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (t.length === 1 && t >= '0' && t <= '9') return parseInt(t, 10);
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 9) return n;
  return null;
}

function parseDigitMatch(raw: string | undefined): boolean | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  return null;
}

/** Matches iOS UnitTestFilenameExpectation.dialDigitMatches (incl. dial 4 bill-lower). */
export function dialDigitMatches(expected: number, predicted: number, dialNumber: number): boolean {
  if (expected === predicted) return true;
  if (dialNumber === 4 && predicted < expected) return true;
  return false;
}

/** Resolve predicted digit from iOS export columns (camelCase + snake_case). */
export function resolvePredictedDigit(row: Record<string, string>, dial: number): number | null {
  const keys = [
    `dial${dial}_predicted_digit`,
    `dial${dial}_finalDigit`,
    `dial${dial}_final_digit`,
    `dial${dial}_stage3_final_digit`,
    `dial${dial}_floorDigit`,
    `dial${dial}_nearestDigit`,
  ];
  for (const key of keys) {
    const digit = parseDigit(row[key]);
    if (digit != null) return digit;
  }
  return null;
}

/**
 * Column index for confusion matrix.
 * Trust iOS digit_match when present; correct reads always land on the diagonal.
 */
export function confusionMatrixPredictedCol(
  expected: number,
  predicted: number | null,
  dialNumber: number,
  digitMatch: boolean | null,
): number | null {
  if (digitMatch === true) return expected;
  if (digitMatch === false) {
    if (predicted != null) return predicted;
    return null;
  }
  if (predicted != null) {
    return dialDigitMatches(expected, predicted, dialNumber) ? expected : predicted;
  }
  return null;
}

export function normalizeConfidencePct(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
}

/** Per-dial accuracy & confidence from CSV summary block (PER_DIAL_BREAKDOWN). */
export function dialStatsFromCsvSummary(summary: UnitTestCsvSummary): UnitTestDialStats[] {
  const out: UnitTestDialStats[] = [];
  for (let d = 1; d <= 4; d += 1) {
    const withGroundTruth = parseInt(String(summary[`dial${d}_with_ground_truth`] ?? ''), 10) || 0;
    const correct = parseInt(String(summary[`dial${d}_correct`] ?? ''), 10) || 0;
    const accRaw = summary[`dial${d}_accuracy_percent`];
    let accuracyPct: number | null = null;
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

/** Recompute per-dial stats from per-image rows when summary breakdown is missing. */
export function dialStatsFromPerImageRows(rows: Record<string, string>[]): UnitTestDialStats[] {
  const out: UnitTestDialStats[] = [];
  for (let d = 1; d <= 4; d += 1) {
    let withGroundTruth = 0;
    let correct = 0;
    const confs: number[] = [];
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

/** Expected digit (rows) vs predicted digit (cols) for one dial or all dials combined. */
export function buildDigitConfusionMatrix(
  rows: Record<string, string>[],
  dial: number | 'all',
): DigitConfusionMatrix {
  const matrix = Array.from({ length: 10 }, () => Array(10).fill(0));
  let total = 0;
  const dials = dial === 'all' ? ([1, 2, 3, 4] as const) : ([dial] as const);

  for (const row of rows) {
    for (const d of dials) {
      const exp = parseDigit(row[`dial${d}_expected_digit`]);
      if (exp == null) continue;
      const pred = resolvePredictedDigit(row, d);
      const digitMatch = parseDigitMatch(row[`dial${d}_digit_match`]);
      const col = confusionMatrixPredictedCol(exp, pred, d, digitMatch);
      if (col == null) continue;
      matrix[exp][col] += 1;
      total += 1;
    }
  }

  return { matrix, total, digits: [...DIGITS] };
}

export function confusionRowTotal(matrix: number[][], rowIndex: number): number {
  const row = matrix[rowIndex];
  if (!row) return 0;
  return row.reduce((sum, n) => sum + n, 0);
}

/** Fraction of row that landed in this cell (0–1). */
export function confusionRowShare(matrix: number[][], rowIndex: number, colIndex: number): number {
  const rowTotal = confusionRowTotal(matrix, rowIndex);
  if (rowTotal <= 0) return 0;
  return matrix[rowIndex][colIndex] / rowTotal;
}

/** Per-digit recall for a ground-truth row (0–1). Diagonal share. */
export function confusionRowRecall(matrix: number[][], rowIndex: number): number {
  return confusionRowShare(matrix, rowIndex, rowIndex);
}

/** Format row share for display (0–100%). */
export function formatConfusionPct(share: number): string {
  if (share <= 0) return '0%';
  if (share >= 0.995) return '100%';
  return `${(share * 100).toFixed(0)}%`;
}

/** Ticks for the dual legend (0–100% of row). */
export const CONFUSION_LEGEND_TICKS = [0, 20, 40, 60, 80, 100] as const;

/** Green: stronger = more of the row predicted correctly (diagonal). */
const CORRECT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [248, 250, 252]],
  [0.25, [220, 252, 231]],
  [0.5, [134, 239, 172]],
  [0.75, [34, 197, 94]],
  [1, [21, 128, 61]],
];

/** Amber → red: stronger = more of the row misread to this digit (off-diagonal). */
const MISREAD_STOPS: Array<[number, [number, number, number]]> = [
  [0, [248, 250, 252]],
  [0.2, [254, 243, 199]],
  [0.4, [253, 230, 138]],
  [0.6, [245, 158, 11]],
  [0.8, [234, 88, 12]],
  [1, [220, 38, 38]],
];

function interpolateStops(
  t: number,
  stops: Array<[number, [number, number, number]]>,
  fallback: [number, number, number],
): string {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i += 1) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (clamped <= t1) {
      const f = t1 === t0 ? 1 : (clamped - t0) / (t1 - t0);
      const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  const [r, g, b] = fallback;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Standard row-normalized confusion matrix coloring:
 * diagonal = green (correct), off-diagonal = amber/red (misread).
 * Intensity = share of that ground-truth row (0–1).
 */
export function confusionMatrixCellFill(
  count: number,
  rowShare: number,
  isCorrect: boolean,
): string {
  if (count <= 0) return '#f8fafc';
  const stops = isCorrect ? CORRECT_STOPS : MISREAD_STOPS;
  const fallback = isCorrect ? ([21, 128, 61] as const) : ([220, 38, 38] as const);
  return interpolateStops(rowShare, stops, [...fallback]);
}

export function confusionMatrixCellText(
  count: number,
  rowShare: number,
  isCorrect: boolean,
): string {
  if (count <= 0) return '#94a3b8';
  if (isCorrect) {
    if (rowShare >= 0.75) return '#ffffff';
    if (rowShare >= 0.4) return '#064e3b';
    return '#0f172a';
  }
  if (rowShare >= 0.6) return '#ffffff';
  if (rowShare >= 0.35) return '#78350f';
  return '#0f172a';
}

/** @deprecated Use confusionMatrixCellFill */
export function confusionCellDeviation(share: number, isMatch: boolean): number {
  if (share <= 0) return 0;
  return isMatch ? 1 - share : share;
}

/** @deprecated */
export type ConfusionColorMode = 'errors' | 'distribution';

/** @deprecated */
export function confusionCellIntensity(
  _mode: ConfusionColorMode,
  share: number,
  isMatch: boolean,
): number {
  return confusionCellDeviation(share, isMatch);
}

/** @deprecated */
export const CONFUSION_DEVIATION_TICKS = CONFUSION_LEGEND_TICKS;

/** @deprecated Use confusionMatrixCellFill */
export function confusionCellHeatFill(
  count: number,
  intensity: number,
  mode: ConfusionColorMode = 'errors',
): string {
  const isCorrect = mode !== 'distribution';
  return confusionMatrixCellFill(count, mode === 'distribution' ? intensity : 1 - intensity, isCorrect);
}

/** @deprecated Use confusionMatrixCellFill */
export function confusionCellDeviationFill(count: number, deviation: number): string {
  return confusionMatrixCellFill(count, 1 - deviation, true);
}

/** @deprecated Use confusionMatrixCellText */
export function confusionCellHeatTextColor(
  count: number,
  intensity: number,
  mode: ConfusionColorMode = 'errors',
): string {
  const isCorrect = mode !== 'distribution';
  const share = mode === 'distribution' ? intensity : 1 - intensity;
  return confusionMatrixCellText(count, share, isCorrect);
}

/** @deprecated Use confusionMatrixCellText */
export function confusionCellDeviationTextColor(count: number, deviation: number): string {
  return confusionMatrixCellText(count, 1 - deviation, true);
}

/** @deprecated Use formatConfusionPct */
export function formatDeviationPct(deviation: number): string {
  return formatConfusionPct(deviation);
}

/** Full-reading correct / incorrect from CSV run summary. */
export function runPerformanceFromSummary(summary: UnitTestCsvSummary): RunPerformance {
  const withGroundTruth =
    summary.withGroundTruth ??
    (parseInt(String(summary.with_filename_ground_truth ?? ''), 10) || 0);
  const correct =
    summary.correct ?? (parseInt(String(summary.correct_readings ?? ''), 10) || 0);
  let accuracyPct: number | null =
    summary.accuracyPercent != null && Number.isFinite(Number(summary.accuracyPercent))
      ? Number(summary.accuracyPercent)
      : null;
  if (accuracyPct == null && summary.accuracy_percent != null && summary.accuracy_percent !== '') {
    const v = parseFloat(String(summary.accuracy_percent));
    if (Number.isFinite(v)) accuracyPct = Math.round(v * 100) / 100;
  }
  if (accuracyPct == null && withGroundTruth > 0) {
    accuracyPct = Math.round((10000 * correct) / withGroundTruth) / 100;
  }
  const incorrect = Math.max(0, withGroundTruth - correct);
  return { accuracyPct, withGroundTruth, correct, incorrect };
}

export function runPerformanceFromPerImageRows(rows: Record<string, string>[]): RunPerformance {
  let withGroundTruth = 0;
  let correct = 0;
  for (const row of rows) {
    const expected = (row.expected_reading_from_filename ?? '').trim();
    if (!expected) continue;
    withGroundTruth += 1;
    const match = parseReadingMatch(row.overall_reading_match);
    if (match === true) correct += 1;
    else if (match === false) {
      /* incorrect */
    } else if (expected === (row.predicted_reading ?? '').trim()) correct += 1;
  }
  const incorrect = Math.max(0, withGroundTruth - correct);
  const accuracyPct =
    withGroundTruth > 0 ? Math.round((10000 * correct) / withGroundTruth) / 100 : null;
  return { accuracyPct, withGroundTruth, correct, incorrect };
}

export function resolveRunPerformance(detail: UnitTestRunDetailResponse): RunPerformance {
  const fromSummary = runPerformanceFromSummary(detail.summary);
  if (fromSummary.withGroundTruth > 0) return fromSummary;
  if (detail.perImageRows?.length) return runPerformanceFromPerImageRows(detail.perImageRows);
  return fromSummary;
}

export function resolveDialStats(detail: UnitTestRunDetailResponse): UnitTestDialStats[] {
  const fromSummary = dialStatsFromCsvSummary(detail.summary);
  if (fromSummary.some((d) => d.withGroundTruth > 0)) return fromSummary;
  if (detail.perImageRows?.length) return dialStatsFromPerImageRows(detail.perImageRows);
  return fromSummary;
}

export function resolveDifficultyTiers(detail: UnitTestRunDetailResponse): UnitTestImageDifficultyTierStats[] {
  const fromCsv = difficultyStatsFromBreakdown(detail.imageDifficultyBreakdown);
  if (fromCsv.length > 0) return fromCsv;
  if (detail.perImageRows?.length) return difficultyStatsFromPerImageRows(detail.perImageRows);
  return [];
}

/** All dial-level prediction confidences from per-image rows (for histogram). */
export function collectDialConfidences(rows: Record<string, string>[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const imageConf = normalizeConfidencePct(row.average_confidence);
    let addedImage = false;
    for (let d = 1; d <= 4; d += 1) {
      const conf = normalizeConfidencePct(
        row[`dial${d}_composite_confidence`] ?? row[`dial${d}_stage2_kp_model_confidence`],
      );
      if (conf != null) {
        out.push(conf);
        addedImage = true;
      }
    }
    if (!addedImage && imageConf != null) out.push(imageConf);
  }
  return out;
}

const HISTOGRAM_EDGES = [0, 50, 60, 70, 75, 80, 85, 90, 95, 98, 100] as const;

export function confidenceHistogramFromPerImageRows(
  rows: Record<string, string>[],
): ConfidenceHistogramBin[] {
  const values = collectDialConfidences(rows);
  const bins: ConfidenceHistogramBin[] = [];
  for (let i = 0; i < HISTOGRAM_EDGES.length - 1; i += 1) {
    const min = HISTOGRAM_EDGES[i];
    const max = HISTOGRAM_EDGES[i + 1];
    const isLast = i === HISTOGRAM_EDGES.length - 2;
    const count = values.filter((v) =>
      isLast ? v >= min && v <= max : v >= min && v < max,
    ).length;
    bins.push({
      label: isLast ? `${min}–${max}%` : `${min}–${max}%`,
      min,
      max,
      count,
    });
  }
  return bins.filter((b) => b.count > 0);
}
