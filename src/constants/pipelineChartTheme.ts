import type { PipelineIterationRecord } from '../services/api';
import {
  inferProductLineForRow,
  productLineDisplay,
  type FactoryProductLine,
} from './factoryStages';
import {
  avgAppDialAccuracyPct,
  avgAppDialConfidencePct,
  avgFtDialAccuracyPct,
  avgSimDialAccuracyPct,
  avgSimDialConfidencePct,
  avgUtDialAccuracyPct,
} from '../utils/iterationMetricsEnrichment';
import { normalizeManualMetricPct } from '../utils/metricNumbers';

/** Matches Model factory product-line chips (p1 sky · p2 violet · p3 emerald). */
export const FACTORY_PRODUCT_LINE_CHART: Record<
  Exclude<FactoryProductLine, 'unknown'>,
  { fill: string; fillMuted: string; stroke: string; label: string }
> = {
  p1: { fill: '#0ea5e9', fillMuted: '#7dd3fc', stroke: '#0284c7', label: 'Sempra (p1)' },
  p2: { fill: '#8b5cf6', fillMuted: '#c4b5fd', stroke: '#7c3aed', label: 'Anica (p2)' },
  p3: { fill: '#10b981', fillMuted: '#6ee7b7', stroke: '#059669', label: 'Sempra + Anica (p3)' },
};

export const PIPELINE_CHART_LINES: Exclude<FactoryProductLine, 'unknown'>[] = ['p1', 'p2', 'p3'];

export type ChartPipelineFilter = 'all' | Exclude<FactoryProductLine, 'unknown'>;

export function chartThemeForLine(line: Exclude<FactoryProductLine, 'unknown'>) {
  return FACTORY_PRODUCT_LINE_CHART[line];
}

/** rgba() from #rrggbb — avoids color-mix() for html2canvas / PDF export. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blend two #rrggbb colors (ratioA = share of color a). */
export function blendHexColors(a: string, b: string, ratioA = 0.55): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const ratioB = 1 - ratioA;
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r1 * ratioA + r2 * ratioB)}${toHex(g1 * ratioA + g2 * ratioB)}${toHex(b1 * ratioA + b2 * ratioB)}`;
}

/** Filter registry rows for charts by product line (color-coded p1 / p2 / p3). */
export function filterRowsByProductLine(
  rows: PipelineIterationRecord[],
  filter: ChartPipelineFilter,
): PipelineIterationRecord[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => inferProductLineForRow(r) === filter);
}

function meanFinite(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function portalPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const v = raw <= 1 && raw >= 0 ? raw * 100 : raw;
  return Math.round(v * 100) / 100;
}

function chartRowRichness(row: PipelineIterationRecord): number {
  const m = row.manualMetrics;
  let n = 0;
  if (m?.readAccuracyFtRow != null) n += 8;
  if (m?.readAccuracyUt != null) n += 4;
  if (m?.exactReadingAccuracyPct != null) n += 2;
  if (avgSimDialConfidencePct(m) != null) n += 1;
  for (let d = 1; d <= 4; d += 1) {
    if (normalizeManualMetricPct(m?.[`simDial${d}ConfidencePct` as keyof typeof m]) != null) n += 2;
    if (normalizeManualMetricPct(m?.[`dial${d}UtPct` as keyof typeof m]) != null) n += 2;
    if (normalizeManualMetricPct(m?.[`dial${d}FtPct` as keyof typeof m]) != null) n += 2;
  }
  return n;
}

/** When duplicate iteration #s exist (e.g. "Sempra -1" #2 vs "Sempra - 2" #1), pick the best row. */
function pickRowForIteration(
  list: PipelineIterationRecord[],
  iterationNumber: number,
): PipelineIterationRecord | undefined {
  const matches = list.filter((r) => r.iterationNumber === iterationNumber);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  return [...matches].sort((a, b) => {
    const score = chartRowRichness(b) - chartRowRichness(a);
    if (score !== 0) return score;
    return a.pipeline.localeCompare(b.pipeline);
  })[0];
}

/** All registry rows for overview charts (6 eval + p3 #3 training, etc.) — excludes simulator / cancelled. */
export function filterRegistryOverviewRows(rows: PipelineIterationRecord[]): PipelineIterationRecord[] {
  return rows.filter((r) => {
    if (String(r.currentStatus).toLowerCase() === 'cancelled') return false;
    return inferProductLineForRow(r) !== 'unknown';
  });
}

/** Iterations shown on metric / image charts per product line (includes p3 #3 in training). */
const CHART_ITERATION_NUMBERS = [1, 2, 3] as const;

/**
 * Registry rows for metric charts: all non-cancelled iterations per product line, sorted.
 * When duplicate iteration #s exist, keeps the richest row for that slot.
 */
export function filterEvalChartRows(rows: PipelineIterationRecord[]): PipelineIterationRecord[] {
  const out: PipelineIterationRecord[] = [];
  for (const line of PIPELINE_CHART_LINES) {
    const list = rows.filter((r) => {
      if (String(r.currentStatus).toLowerCase() === 'cancelled') return false;
      return inferProductLineForRow(r) === line;
    });
    const iterNums = [...new Set(list.map((r) => r.iterationNumber))].sort((a, b) => a - b);
    for (const iterNum of iterNums.length ? iterNums : CHART_ITERATION_NUMBERS) {
      const row = pickRowForIteration(list, iterNum);
      if (row) out.push(row);
    }
  }
  return out.sort((a, b) => {
    const la = inferProductLineForRow(a);
    const lb = inferProductLineForRow(b);
    const ia = PIPELINE_CHART_LINES.indexOf(la as Exclude<FactoryProductLine, 'unknown'>);
    const ib = PIPELINE_CHART_LINES.indexOf(lb as Exclude<FactoryProductLine, 'unknown'>);
    if (ia !== ib) return ia - ib;
    return a.iterationNumber - b.iterationNumber;
  });
}

/** read − sim when both sides exist (positive = read ahead). */
export function simReadGapPct(read: number | null, sim: number | null): number | null {
  if (read == null || sim == null || !Number.isFinite(read) || !Number.isFinite(sim)) return null;
  return Math.round((read - sim) * 100) / 100;
}

export function simConfidencePct(row: PipelineIterationRecord): number | null {
  const v = avgSimDialConfidencePct(row.manualMetrics);
  if (v != null && Number.isFinite(v)) return Math.round(v * 100) / 100;
  const p = row.portalStats;
  if (p?.avgSessionConfidence != null && Number.isFinite(p.avgSessionConfidence)) {
    return portalPct(p.avgSessionConfidence);
  }
  return null;
}

/** App / on-device read confidence (avg app dial confidence → app bbox/keypoint). */
export function readConfidencePct(row: PipelineIterationRecord): number | null {
  const m = row.manualMetrics;
  const dial = avgAppDialConfidencePct(m);
  if (dial != null) return Math.round(dial * 100) / 100;
  const appConf = meanFinite(
    [m?.appAvgBboxConfidence, m?.appAvgKeypointConfidence].filter(
      (v): v is number => v != null && Number.isFinite(v),
    ),
  );
  if (appConf != null) return Math.round(appConf * 100) / 100;
  return null;
}

/** Simulator accuracy: sim dials → laptop summary → portal UT dials. */
export function simAccuracyPct(row: PipelineIterationRecord): number | null {
  const m = row.manualMetrics;
  const simDial = avgSimDialAccuracyPct(m);
  if (simDial != null) return Math.round(simDial * 100) / 100;
  if (m?.readAccuracySimulatorLaptop != null && Number.isFinite(m.readAccuracySimulatorLaptop)) {
    return m.readAccuracySimulatorLaptop;
  }
  const utAvg = avgUtDialAccuracyPct(m);
  if (utAvg != null) return Math.round(utAvg * 100) / 100;

  const p = row.portalStats;
  if (p) {
    if (p.digitMatchUtPct != null && Number.isFinite(p.digitMatchUtPct)) return portalPct(p.digitMatchUtPct);
    const utDials = meanFinite(
      [p.dial1UtPct, p.dial2UtPct, p.dial3UtPct, p.dial4UtPct].filter(
        (v): v is number => v != null && Number.isFinite(v),
      ),
    );
    if (utDials != null) return Math.round(utDials * 100) / 100;
  }
  return null;
}

/** Read / app accuracy: app dials → UT/FT row summaries → portal FT dials. */
export function readAccuracyPct(row: PipelineIterationRecord): number | null {
  const m = row.manualMetrics;
  const appDial = avgAppDialAccuracyPct(m);
  if (appDial != null) return Math.round(appDial * 100) / 100;
  if (m?.readAccuracyUt != null && Number.isFinite(m.readAccuracyUt)) return m.readAccuracyUt;
  if (m?.readAccuracyFtRow != null && Number.isFinite(m.readAccuracyFtRow)) return m.readAccuracyFtRow;
  if (m?.exactReadingAccuracyPct != null && Number.isFinite(m.exactReadingAccuracyPct)) {
    return m.exactReadingAccuracyPct;
  }
  const ftAvg = avgFtDialAccuracyPct(m);
  if (ftAvg != null) return Math.round(ftAvg * 100) / 100;

  const p = row.portalStats;
  if (p) {
    if (p.digitMatchFtPct != null && Number.isFinite(p.digitMatchFtPct)) return portalPct(p.digitMatchFtPct);
    const ftDials = meanFinite(
      [p.dial1FtPct, p.dial2FtPct, p.dial3FtPct, p.dial4FtPct].filter(
        (v): v is number => v != null && Number.isFinite(v),
      ),
    );
    if (ftDials != null) return Math.round(ftDials * 100) / 100;
  }
  return null;
}

/** Eval accuracy (FT → UT → exact → portal queue) — not used on sim-vs-read charts. */
export function evalAccuracyPct(row: PipelineIterationRecord): number | null {
  const m = row.manualMetrics;
  if (m?.readAccuracyFtRow != null && Number.isFinite(m.readAccuracyFtRow)) return m.readAccuracyFtRow;
  const ftAvg = avgFtDialAccuracyPct(m);
  if (ftAvg != null) return Math.round(ftAvg * 100) / 100;
  if (m?.readAccuracyUt != null && Number.isFinite(m.readAccuracyUt)) return m.readAccuracyUt;
  if (m?.exactReadingAccuracyPct != null && Number.isFinite(m.exactReadingAccuracyPct)) {
    return m.exactReadingAccuracyPct;
  }
  const utAvg = avgUtDialAccuracyPct(m);
  if (utAvg != null) return Math.round(utAvg * 100) / 100;

  const p = row.portalStats;
  if (p) {
    if (p.digitMatchFtPct != null && Number.isFinite(p.digitMatchFtPct)) return portalPct(p.digitMatchFtPct);
    const ftDials = meanFinite(
      [p.dial1FtPct, p.dial2FtPct, p.dial3FtPct, p.dial4FtPct].filter(
        (v): v is number => v != null && Number.isFinite(v),
      ),
    );
    if (ftDials != null) return Math.round(ftDials * 100) / 100;
    if (p.digitMatchUtPct != null && Number.isFinite(p.digitMatchUtPct)) return portalPct(p.digitMatchUtPct);
    const utDials = meanFinite(
      [p.dial1UtPct, p.dial2UtPct, p.dial3UtPct, p.dial4UtPct].filter(
        (v): v is number => v != null && Number.isFinite(v),
      ),
    );
    if (utDials != null) return Math.round(utDials * 100) / 100;
    if (p.queueCorrectRateAll != null && Number.isFinite(p.queueCorrectRateAll)) {
      return portalPct(p.queueCorrectRateAll);
    }
  }
  return null;
}

/** Manual review rate %, or estimated from portal non-correct share when manual is blank. */
export function manualReviewRatePct(row: PipelineIterationRecord): number | null {
  const v = row.manualMetrics?.manualReviewRatePct;
  if (v != null && Number.isFinite(v)) return Math.min(100, Math.max(0, v));
  const correct = row.portalStats?.queueCorrectRateAll;
  if (correct != null && Number.isFinite(correct)) {
    const pct = correct <= 1 ? (1 - correct) * 100 : 100 - correct;
    return Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
  }
  return null;
}

/** @deprecated use evalAccuracyPct */
export function primaryEvalAccuracyPct(row: PipelineIterationRecord): number | null {
  return evalAccuracyPct(row);
}

export type PipelineIterationChartPoint = {
  id: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  pipeline: string;
  iterationNumber: number;
  xLabel: string;
  simConfidencePct: number | null;
  readConfidencePct: number | null;
  simAccuracyPct: number | null;
  readAccuracyPct: number | null;
  /** read − sim confidence */
  confGapPct: number | null;
  /** read − sim accuracy */
  accGapPct: number | null;
  /** Full-meter / eval golden accuracy (FT → UT → exact). */
  exactReadingPct: number | null;
};

export type PerDialMetricRow = {
  dial: string;
  simConf: number | null;
  appConf: number | null;
  simAcc: number | null;
  appAcc: number | null;
};

const DIAL_NUMS = [1, 2, 3, 4] as const;

function dialField(
  m: PipelineIterationRecord['manualMetrics'],
  prefix: 'simDial' | 'appDial',
  n: (typeof DIAL_NUMS)[number],
  metric: 'ConfidencePct' | 'AccuracyPct',
): number | null {
  if (!m) return null;
  const key = `${prefix}${n}${metric}` as keyof NonNullable<typeof m>;
  return normalizeManualMetricPct(m[key]);
}

function manualUtDialPct(m: PipelineIterationRecord['manualMetrics'], n: (typeof DIAL_NUMS)[number]): number | null {
  if (!m) return null;
  const key = `dial${n}UtPct` as keyof NonNullable<typeof m>;
  return normalizeManualMetricPct(m[key]);
}

function manualFtDialPct(m: PipelineIterationRecord['manualMetrics'], n: (typeof DIAL_NUMS)[number]): number | null {
  if (!m) return null;
  const key = `dial${n}FtPct` as keyof NonNullable<typeof m>;
  return normalizeManualMetricPct(m[key]);
}

function portalDialPct(
  row: PipelineIterationRecord,
  kind: 'ut' | 'ft',
  n: (typeof DIAL_NUMS)[number],
): number | null {
  const p = row.portalStats;
  if (!p) return null;
  const key = `dial${n}${kind === 'ut' ? 'Ut' : 'Ft'}Pct` as keyof typeof p;
  return portalPct(p[key] as number | null | undefined);
}

/**
 * Per-dial sim/app confidence & accuracy for one registry row.
 * Accuracy falls back to dial1–4 UT % (sim/UT) and FT % (app/field) when simDial/appDial accuracy columns are empty.
 */
export function perDialMetricsFromRow(row: PipelineIterationRecord): PerDialMetricRow[] {
  const m = row.manualMetrics;
  return DIAL_NUMS.map((n) => ({
    dial: `Dial ${n}`,
    simConf: dialField(m, 'simDial', n, 'ConfidencePct'),
    appConf: dialField(m, 'appDial', n, 'ConfidencePct'),
    simAcc:
      dialField(m, 'simDial', n, 'AccuracyPct') ?? manualUtDialPct(m, n) ?? portalDialPct(row, 'ut', n),
    appAcc:
      dialField(m, 'appDial', n, 'AccuracyPct') ?? manualFtDialPct(m, n) ?? portalDialPct(row, 'ft', n),
  }));
}

export function rowHasPerDialMetrics(row: PipelineIterationRecord): boolean {
  return perDialMetricsFromRow(row).some(
    (d) => d.simConf != null || d.appConf != null || d.simAcc != null || d.appAcc != null,
  );
}

export function buildPipelineIterationChartPoints(
  rows: PipelineIterationRecord[],
): PipelineIterationChartPoint[] {
  return filterEvalChartRows(rows).map((r) => {
    const line = inferProductLineForRow(r) as Exclude<FactoryProductLine, 'unknown'>;
    const short = r.pipeline.trim().replace(/\s+/g, ' ');
    return {
      id: r.id,
      line,
      pipeline: productLineDisplay(line),
      iterationNumber: r.iterationNumber,
      xLabel: `${short} · #${r.iterationNumber}`,
      simConfidencePct: simConfidencePct(r),
      readConfidencePct: readConfidencePct(r),
      simAccuracyPct: simAccuracyPct(r),
      readAccuracyPct: readAccuracyPct(r),
      confGapPct: simReadGapPct(readConfidencePct(r), simConfidencePct(r)),
      accGapPct: simReadGapPct(readAccuracyPct(r), simAccuracyPct(r)),
      exactReadingPct: evalAccuracyPct(r),
    };
  });
}

export type PipelineGroupedChartRow = {
  pipeline: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  slots: {
    iterationNumber: number;
    simConfidencePct: number | null;
    readConfidencePct: number | null;
    simAccuracyPct: number | null;
    readAccuracyPct: number | null;
  }[];
};

export function buildPipelineGroupedChartRows(
  rows: PipelineIterationRecord[],
): { chartRows: PipelineGroupedChartRow[]; maxSlots: number } {
  const chartRows: PipelineGroupedChartRow[] = [];

  const evalOnly = filterEvalChartRows(rows);
  for (const line of PIPELINE_CHART_LINES) {
    const list = evalOnly.filter((r) => inferProductLineForRow(r) === line);
    if (!list.length) continue;
    chartRows.push({
      pipeline: productLineDisplay(line),
      line,
      slots: list.map((r) => ({
        iterationNumber: r.iterationNumber,
        simConfidencePct: simConfidencePct(r),
        readConfidencePct: readConfidencePct(r),
        simAccuracyPct: simAccuracyPct(r),
        readAccuracyPct: readAccuracyPct(r),
      })),
    });
  }

  const maxSlots = Math.max(0, ...chartRows.map((r) => r.slots.length));
  return { chartRows, maxSlots };
}

/** One row per pipeline for grouped confidence + accuracy bars (iter 1 & 2). */
export function flattenPipelineMetricGroups(rows: PipelineIterationRecord[]): Array<
  Record<string, string | number | null> & { pipeline: string; line: Exclude<FactoryProductLine, 'unknown'> }
> {
  const { chartRows } = buildPipelineGroupedChartRows(rows);
  return chartRows.map((group) => {
    const flat: Record<string, string | number | null> = {
      pipeline: group.pipeline,
      line: group.line,
    };
    group.slots.forEach((slot, idx) => {
      const n = idx + 1;
      flat[`simConf_${n}`] = slot.simConfidencePct;
      flat[`readConf_${n}`] = slot.readConfidencePct;
      flat[`simAcc_${n}`] = slot.simAccuracyPct;
      flat[`readAcc_${n}`] = slot.readAccuracyPct;
      flat[`iterNum_${n}`] = slot.iterationNumber;
    });
    return flat as Record<string, string | number | null> & {
      pipeline: string;
      line: Exclude<FactoryProductLine, 'unknown'>;
    };
  });
}

export function pipelineImprovementSummary(row: PipelineGroupedChartRow): string | null {
  if (row.slots.length < 2) return null;
  const first = row.slots[0].readAccuracyPct;
  const last = row.slots[row.slots.length - 1].readAccuracyPct;
  if (first == null || last == null) return null;
  const delta = last - first;
  const sign = delta >= 0 ? '+' : '';
  return `#${row.slots[0].iterationNumber} → #${row.slots[row.slots.length - 1].iterationNumber}: ${sign}${delta.toFixed(1)} pts read accuracy`;
}

export type AppLineChartSeries = {
  dataKey: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  label: string;
  stroke: string;
};

export type AppLineChartRow = {
  iteration: number;
  iterationLabel: string;
  [key: string]: number | string | null;
};

function appLineDataKey(line: Exclude<FactoryProductLine, 'unknown'>): string {
  return line;
}

function appImagesForRow(row: PipelineIterationRecord): number | null {
  const n = row.imageCount ?? row.portalStats?.totalImages ?? null;
  return n != null && Number.isFinite(n) ? n : null;
}

function appMetricForRow(
  row: PipelineIterationRecord,
  metric: 'accuracy' | 'confidence',
  dial?: number,
): number | null {
  if (dial != null && dial >= 1 && dial <= 4) {
    const d = perDialMetricsFromRow(row)[dial - 1];
    if (!d) return null;
    return metric === 'accuracy' ? d.appAcc : d.appConf;
  }
  return metric === 'accuracy' ? readAccuracyPct(row) : readConfidencePct(row);
}

/**
 * Line-chart rows keyed by iteration #, one series per product line (app metrics only).
 */
export function buildAppMetricLineChart(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
  metric: 'images' | 'accuracy' | 'confidence',
  dial?: number,
): { chartRows: AppLineChartRow[]; series: AppLineChartSeries[] } {
  const scoped = filterRowsByProductLine(filterEvalChartRows(rows), pipelineFilter);
  const lines =
    pipelineFilter === 'all'
      ? PIPELINE_CHART_LINES
      : [pipelineFilter as Exclude<FactoryProductLine, 'unknown'>];

  const series: AppLineChartSeries[] = lines.map((line) => ({
    dataKey: appLineDataKey(line),
    line,
    label: FACTORY_PRODUCT_LINE_CHART[line].label,
    stroke: FACTORY_PRODUCT_LINE_CHART[line].stroke,
  }));

  const iterationSet = new Set<number>();
  for (const r of scoped) iterationSet.add(r.iterationNumber);
  const iterations = [...iterationSet].sort((a, b) => a - b);

  const chartRows: AppLineChartRow[] = iterations.map((iteration) => {
    const row: AppLineChartRow = {
      iteration,
      iterationLabel: `#${iteration}`,
    };
    for (const line of lines) {
      const match = scoped.find(
        (r) => inferProductLineForRow(r) === line && r.iterationNumber === iteration,
      );
      const key = appLineDataKey(line);
      if (!match) {
        row[key] = null;
        continue;
      }
      if (metric === 'images') {
        row[key] = appImagesForRow(match);
      } else {
        row[key] = appMetricForRow(match, metric, dial);
      }
    }
    return row;
  });

  return { chartRows, series: series.filter((s) => chartRows.some((r) => r[s.dataKey] != null)) };
}

export type LatestDialAppMetric = {
  dial: number;
  accuracy: number | null;
  confidence: number | null;
};

/** Latest iteration in scope — per-dial app accuracy & confidence (averaged if multiple lines at same iter). */
export function latestPerDialAppMetrics(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
): LatestDialAppMetric[] {
  const scoped = filterRowsByProductLine(filterEvalChartRows(rows), pipelineFilter);
  if (!scoped.length) {
    return [1, 2, 3, 4].map((dial) => ({ dial, accuracy: null, confidence: null }));
  }

  const latestIter = Math.max(...scoped.map((r) => r.iterationNumber));
  const latestRows = scoped.filter((r) => r.iterationNumber === latestIter);

  return [1, 2, 3, 4].map((dial) => {
    const accVals: number[] = [];
    const confVals: number[] = [];
    for (const row of latestRows) {
      const d = perDialMetricsFromRow(row)[dial - 1];
      if (!d) continue;
      if (d.appAcc != null && Number.isFinite(d.appAcc)) accVals.push(d.appAcc);
      if (d.appConf != null && Number.isFinite(d.appConf)) confVals.push(d.appConf);
    }
    const avg = (vals: number[]): number | null =>
      vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    return { dial, accuracy: avg(accVals), confidence: avg(confVals) };
  });
}
