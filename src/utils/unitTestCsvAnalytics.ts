import type {
  UnitTestCsvSummary,
  UnitTestImageDifficultyTier,
  UnitTestRunDetailResponse,
} from '../services/api';
import { difficultyToCode } from './unitTestImageNaming';
import { roundPortalAccuracyConfidencePct, confidencePctFromRaw, normalizeConfidencePct } from './portalMetricFormat';

export { normalizeConfidencePct } from './portalMetricFormat';

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
  /** Field test: dial wrong on captures reviewer marked incorrect. */
  wrongOnIncorrectCaptures?: number;
  /** Field test: total captures reviewer marked incorrect (same across dials). */
  incorrectCaptureCount?: number;
};

/** Human-readable dial accuracy counts for field test donuts / tooltips. */
export function formatFieldTestDialCountLabels(stat: UnitTestDialStats): {
  /** e.g. "9/12" — dial wrong on reviewer-incorrect captures */
  onIncorrect: string | null;
  onIncorrectCaption: string | null;
  /** e.g. "238/247" — correct dial reads across all scored captures */
  overall: string | null;
  overallCaption: string | null;
} {
  const onIncorrect =
    stat.incorrectCaptureCount != null &&
    stat.incorrectCaptureCount > 0 &&
    stat.wrongOnIncorrectCaptures != null
      ? `${stat.wrongOnIncorrectCaptures}/${stat.incorrectCaptureCount}`
      : null;
  const overall =
    stat.withGroundTruth > 0 ? `${stat.correct}/${stat.withGroundTruth}` : null;
  return {
    onIncorrect,
    onIncorrectCaption: onIncorrect ? 'wrong on reviewed incorrect captures' : null,
    overall,
    overallCaption: overall ? 'correct on captures (this dial only)' : null,
  };
}

/** Short dial donut / bar hover, e.g. "6/9 incorrect". */
export function formatFieldTestDialHoverNote(stat: UnitTestDialStats): string | null {
  const labels = formatFieldTestDialCountLabels(stat);
  return labels.onIncorrect ? `${labels.onIncorrect} incorrect` : null;
}

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
        b.withGroundTruth > 0
          ? roundPortalAccuracyConfidencePct((100 * b.correct) / b.withGroundTruth)
          : null,
      confidencePct:
        b.confs.length > 0
          ? roundPortalAccuracyConfidencePct(b.confs.reduce((a, c) => a + c, 0) / b.confs.length)
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

export type ConfusionMatrixOptions = {
  /**
   * Field test: always use the model’s predicted digit (strict equality vs true digit).
   * No dial-4 bill-lower forgiveness and no forcing non-flagged dials onto the diagonal.
   */
  strictModelPrediction?: boolean;
};

/**
 * Column index for confusion matrix.
 * Unit test: trust iOS digit_match when present; dial 4 may use bill-lower tolerance.
 * Field test (`strictModelPrediction`): raw ML prediction only.
 */
export function confusionMatrixPredictedCol(
  expected: number,
  predicted: number | null,
  dialNumber: number,
  digitMatch: boolean | null,
  options?: ConfusionMatrixOptions,
): number | null {
  if (options?.strictModelPrediction) {
    return predicted != null ? predicted : null;
  }
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

/** Per-dial accuracy & confidence from CSV summary block (PER_DIAL_BREAKDOWN). */
export function dialStatsFromCsvSummary(summary: UnitTestCsvSummary): UnitTestDialStats[] {
  const out: UnitTestDialStats[] = [];
  for (let d = 1; d <= 4; d += 1) {
    const withGroundTruth = parseInt(String(summary[`dial${d}_with_ground_truth`] ?? ''), 10) || 0;
    const correct = parseInt(String(summary[`dial${d}_correct`] ?? ''), 10) || 0;
    const accRaw = summary[`dial${d}_accuracy_percent`];
    let accuracyPct: number | null = null;
    if (withGroundTruth > 0) {
      accuracyPct = roundPortalAccuracyConfidencePct((100 * correct) / withGroundTruth);
    } else if (accRaw != null && accRaw !== '') {
      const v = parseFloat(String(accRaw));
      if (Number.isFinite(v)) accuracyPct = roundPortalAccuracyConfidencePct(v);
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

export type DialStatsOptions = {
  /** Field test: strict digit equality, honor reviewer incorrect-dial flags. */
  fieldTest?: boolean;
  /** Reviewer-marked incorrect capture count (e.g. 12) — overrides per-row inference. */
  incorrectCaptureCount?: number;
};

/** Arithmetic mean of per-dial accuracy % (D1–D4). */
export function averageDialAccuracyPct(stats: UnitTestDialStats[]): number | null {
  const pcts = stats
    .map((d) => d.accuracyPct)
    .filter((p): p is number => p != null && Number.isFinite(p));
  if (pcts.length === 0) return null;
  return roundPortalAccuracyConfidencePct(pcts.reduce((sum, p) => sum + p, 0) / pcts.length);
}

/** Strict model digit vs reviewer ground truth (no dial-4 bill-lower). */
export function fieldTestDialIsCorrect(row: Record<string, string>, dial: number): boolean | null {
  if (incorrectDialSetFromRow(row).has(dial)) return false;
  const exp = parseDigit(row[`dial${dial}_expected_digit`]);
  if (exp == null) return null;
  const pred = resolvePredictedDigit(row, dial);
  if (pred == null) return false;
  return pred === exp;
}

/** Matches Field test Images → “Reviewed incorrect” cohort. */
function captureIncorrectFromFieldTestRow(row: Record<string, string>): boolean {
  const marked = parseReadingMatch(row.reviewer_marked_incorrect);
  if (marked === true) return true;
  if (marked === false) return false;
  const feedback = String(row.feedback_type || '').trim().toLowerCase();
  if (feedback === 'incorrect') return true;
  const status = String(row.folder_status || '').trim().toLowerCase();
  const manuallyReviewed = parseReadingMatch(row.is_manually_reviewed) === true;
  return (
    status === 'incorrect_analyzed' ||
    status === 'incorrect_labeled' ||
    status === 'incorrect_training' ||
    (status === 'incorrect_new' && manuallyReviewed)
  );
}

function captureCorrectFromFieldTestRow(row: Record<string, string>): boolean {
  if (captureIncorrectFromFieldTestRow(row)) return false;
  const reviewer = parseReadingMatch(row.reviewer_capture_correct);
  if (reviewer === true) return true;
  const feedback = String(row.feedback_type || '').trim().toLowerCase();
  if (feedback === 'correct') return true;
  const status = String(row.folder_status || '').trim().toLowerCase();
  if (status === 'correct') return true;
  return parseReadingMatch(row.is_correct) === true;
}

export function incorrectDialSetFromRow(row: Record<string, string>): Set<number> {
  const raw = String(row.incorrect_dial_numbers ?? '').trim();
  if (!raw) return new Set();
  const out = new Set<number>();
  for (const part of raw.split(/[,;]+/)) {
    const n = parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 4) out.add(n);
  }
  return out;
}

/** Recompute per-dial stats from per-image rows when summary breakdown is missing. */
export function dialStatsFromPerImageRows(
  rows: Record<string, string>[],
  options?: DialStatsOptions,
): UnitTestDialStats[] {
  const incorrectCaptureCount =
    options?.incorrectCaptureCount ??
    (options?.fieldTest
      ? rows.filter((row) => captureIncorrectFromFieldTestRow(row)).length
      : 0);

  const out: UnitTestDialStats[] = [];
  for (let d = 1; d <= 4; d += 1) {
    let withGroundTruth = 0;
    let correct = 0;
    let wrongOnIncorrectCaptures = 0;
    const confs: number[] = [];
    for (const row of rows) {
      if (options?.fieldTest) {
        const ok = fieldTestDialIsCorrect(row, d);
        if (ok == null) continue;
        withGroundTruth += 1;
        if (ok) correct += 1;
        else if (captureIncorrectFromFieldTestRow(row)) wrongOnIncorrectCaptures += 1;
      } else {
        const exp = parseDigit(row[`dial${d}_expected_digit`]);
        if (exp == null) continue;
        withGroundTruth += 1;
        const incorrectDials = incorrectDialSetFromRow(row);
        if (incorrectDials.has(d)) {
          /* reviewer-flagged model miss */
        } else {
          const pred = resolvePredictedDigit(row, d);
          const digitMatch = parseDigitMatch(row[`dial${d}_digit_match`]);
          if (digitMatch === true) {
            correct += 1;
          } else if (
            digitMatch !== false &&
            pred != null &&
            dialDigitMatches(exp, pred, d)
          ) {
            correct += 1;
          }
        }
      }
      const conf = confidencePctFromRaw(
        row[`dial${d}_composite_confidence`] ??
          row[`dial${d}_stage2_kp_model_confidence`] ??
          row[`dial${d}_confidence`] ??
          row.average_confidence,
      );
      if (conf != null) confs.push(conf);
    }
    out.push({
      dial: d,
      withGroundTruth,
      correct,
      accuracyPct:
        withGroundTruth > 0
          ? roundPortalAccuracyConfidencePct((100 * correct) / withGroundTruth)
          : null,
      confidencePct:
        confs.length > 0
          ? roundPortalAccuracyConfidencePct(confs.reduce((a, b) => a + b, 0) / confs.length)
          : null,
      ...(options?.fieldTest
        ? {
            wrongOnIncorrectCaptures,
            incorrectCaptureCount,
          }
        : {}),
    });
  }
  return out;
}

/** Expected digit (rows) vs predicted digit (cols) for one dial or all dials combined. */
export function buildDigitConfusionMatrix(
  rows: Record<string, string>[],
  dial: number | 'all',
  options?: ConfusionMatrixOptions,
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
      const col = confusionMatrixPredictedCol(exp, pred, d, digitMatch, options);
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

/** Ticks for the accuracy legend (95–100% recall on diagonal). */
export const CONFUSION_LEGEND_TICKS = [95, 96, 97, 98, 99, 100] as const;

/** Misread legend ticks (share of row that landed in this off-diagonal cell). */
export const CONFUSION_MISREAD_LEGEND_TICKS = [0, 20, 40, 60, 80, 100] as const;

/** Diagonal recall scale: 95% = red, 100% = green (matches training analytics). */
const RECALL_ACCURACY_STOPS: Array<[number, [number, number, number]]> = [
  [0, [220, 38, 38]],
  [0.35, [253, 230, 138]],
  [0.65, [134, 239, 172]],
  [1, [21, 128, 61]],
];

/** Off-diagonal: light → deep red as misread share of row grows. */
const MISREAD_STOPS: Array<[number, [number, number, number]]> = [
  [0, [248, 250, 252]],
  [0.2, [254, 243, 199]],
  [0.4, [253, 230, 138]],
  [0.6, [245, 158, 11]],
  [0.8, [234, 88, 12]],
  [1, [220, 38, 38]],
];

const CONFUSION_RECALL_FLOOR_PCT = 95;

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

/** Map row recall (0–1) to 95–100% accuracy color scale. */
export function confusionRecallAccuracyFill(recallShare: number): string {
  const pct = recallShare * 100;
  const t = Math.max(0, Math.min(1, (pct - CONFUSION_RECALL_FLOOR_PCT) / (100 - CONFUSION_RECALL_FLOOR_PCT)));
  return interpolateStops(t, RECALL_ACCURACY_STOPS, [21, 128, 61]);
}

/**
 * Row-normalized confusion matrix coloring:
 * diagonal = 95% (red) → 100% (green) by recall; off-diagonal = amber/red by misread share.
 */
export function confusionMatrixCellFill(
  count: number,
  rowShare: number,
  isCorrect: boolean,
): string {
  if (count <= 0) return '#f8fafc';
  if (isCorrect) return confusionRecallAccuracyFill(rowShare);
  return interpolateStops(rowShare, MISREAD_STOPS, [220, 38, 38]);
}

export function confusionMatrixCellText(
  count: number,
  rowShare: number,
  isCorrect: boolean,
): string {
  if (count <= 0) return '#94a3b8';
  if (isCorrect) {
    const pct = rowShare * 100;
    if (pct >= 99) return '#ffffff';
    if (pct >= 97) return '#064e3b';
    if (pct >= 95) return '#0f172a';
    return '#ffffff';
  }
  if (rowShare >= 0.6) return '#ffffff';
  if (rowShare >= 0.35) return '#78350f';
  return '#0f172a';
}

export function perImageRowFileName(row: Record<string, string>): string {
  const fromKey = (row.s3_key || '').split('/').pop() || '';
  return (row.filename || row.image_file_name || fromKey).trim();
}

export function perImageRowSessionId(row: Record<string, string>): string {
  return (row.session_id || '').trim();
}

/** Per-image rows that contributed to an off-diagonal confusion cell. */
export function filterConfusionMisreadRows(
  rows: Record<string, string>[],
  expectedDigit: number,
  predictedDigit: number,
  dial: number | 'all',
  options?: ConfusionMatrixOptions,
): Record<string, string>[] {
  if (expectedDigit === predictedDigit) return [];
  const dials = dial === 'all' ? ([1, 2, 3, 4] as const) : ([dial] as const);
  return rows.filter((row) => {
    for (const d of dials) {
      const exp = parseDigit(row[`dial${d}_expected_digit`]);
      if (exp !== expectedDigit) continue;
      const pred = resolvePredictedDigit(row, d);
      const digitMatch = parseDigitMatch(row[`dial${d}_digit_match`]);
      const col = confusionMatrixPredictedCol(exp, pred, d, digitMatch, options);
      if (col === predictedDigit) return true;
    }
    return false;
  });
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
    if (Number.isFinite(v)) accuracyPct = roundPortalAccuracyConfidencePct(v);
  }
  if (accuracyPct == null && withGroundTruth > 0) {
    accuracyPct = roundPortalAccuracyConfidencePct((100 * correct) / withGroundTruth);
  }
  const incorrect = Math.max(0, withGroundTruth - correct);
  return { accuracyPct, withGroundTruth, correct, incorrect };
}

export function runPerformanceFromPerImageRows(
  rows: Record<string, string>[],
  options?: DialStatsOptions,
): RunPerformance {
  let withGroundTruth = 0;
  let correct = 0;
  for (const row of rows) {
    if (options?.fieldTest) {
      withGroundTruth += 1;
      if (captureCorrectFromFieldTestRow(row)) correct += 1;
      continue;
    }
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
    withGroundTruth > 0
      ? roundPortalAccuracyConfidencePct((100 * correct) / withGroundTruth)
      : null;
  return { accuracyPct, withGroundTruth, correct, incorrect };
}

export function resolveRunPerformance(detail: UnitTestRunDetailResponse): RunPerformance {
  const fieldTest = isFieldTestRunDetail(detail);
  if (fieldTest && detail.perImageRows?.length) {
    return runPerformanceFromPerImageRows(detail.perImageRows, { fieldTest: true });
  }
  const fromSummary = runPerformanceFromSummary(detail.summary);
  if (fromSummary.withGroundTruth > 0) return fromSummary;
  if (detail.perImageRows?.length) return runPerformanceFromPerImageRows(detail.perImageRows);
  return fromSummary;
}

export function isFieldTestRunDetail(detail: UnitTestRunDetailResponse): boolean {
  return String(detail.key || '').startsWith('field-test-cycle:');
}

export function resolveDialStats(
  detail: UnitTestRunDetailResponse,
  options?: DialStatsOptions,
): UnitTestDialStats[] {
  const fieldTest = options?.fieldTest ?? isFieldTestRunDetail(detail);
  if (detail.perImageRows?.length) {
    const rowOptions: DialStatsOptions | undefined = fieldTest
      ? { fieldTest: true, incorrectCaptureCount: options?.incorrectCaptureCount }
      : undefined;
    const fromRows = dialStatsFromPerImageRows(detail.perImageRows, rowOptions);
    if (fromRows.some((d) => d.withGroundTruth > 0)) return fromRows;
  }
  return dialStatsFromCsvSummary(detail.summary);
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
