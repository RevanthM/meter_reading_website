import type { PipelineIterationRecord } from '../services/api';
import {
  inferProductLineForRow,
  productLineDisplay,
  type FactoryProductLine,
} from './factoryStages';
import {
  avgFtDialAccuracyPct,
  avgSimDialConfidencePct,
  avgUtDialAccuracyPct,
} from '../utils/iterationMetricsEnrichment';

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

export function chartThemeForLine(line: Exclude<FactoryProductLine, 'unknown'>) {
  return FACTORY_PRODUCT_LINE_CHART[line];
}

function chartRowRichness(row: PipelineIterationRecord): number {
  const m = row.manualMetrics;
  let n = 0;
  if (m?.readAccuracyFtRow != null) n += 8;
  if (m?.readAccuracyUt != null) n += 4;
  if (m?.exactReadingAccuracyPct != null) n += 2;
  if (avgSimDialConfidencePct(m) != null) n += 1;
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

/**
 * Six completed eval rows for charts: iteration #1 and #2 per product line.
 * Uses iteration number explicitly (not .slice(0,2)) so a stray "Sempra - 2" #1 row
 * does not hide Sempra -1 #2.
 */
export function filterEvalChartRows(rows: PipelineIterationRecord[]): PipelineIterationRecord[] {
  const out: PipelineIterationRecord[] = [];
  for (const line of PIPELINE_CHART_LINES) {
    const list = rows.filter((r) => {
      if (String(r.currentStatus).toLowerCase() === 'cancelled') return false;
      return inferProductLineForRow(r) === line;
    });
    for (const iterNum of [1, 2] as const) {
      const row = pickRowForIteration(list, iterNum);
      if (row) out.push(row);
    }
  }
  return out;
}

export function simConfidencePct(row: PipelineIterationRecord): number | null {
  const v = avgSimDialConfidencePct(row.manualMetrics);
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/** Read accuracy: field test → unit test → exact reading → UT dial avg. */
export function readAccuracyPct(row: PipelineIterationRecord): number | null {
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
  return null;
}

/** @deprecated use readAccuracyPct */
export function primaryEvalAccuracyPct(row: PipelineIterationRecord): number | null {
  return readAccuracyPct(row);
}

export type PipelineIterationChartPoint = {
  id: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  pipeline: string;
  iterationNumber: number;
  xLabel: string;
  confidencePct: number | null;
  accuracyPct: number | null;
};

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
      confidencePct: simConfidencePct(r),
      accuracyPct: readAccuracyPct(r),
    };
  });
}

export type PipelineGroupedChartRow = {
  pipeline: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  slots: {
    iterationNumber: number;
    confidencePct: number | null;
    accuracyPct: number | null;
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
        confidencePct: simConfidencePct(r),
        accuracyPct: readAccuracyPct(r),
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
      flat[`conf_${n}`] = slot.confidencePct;
      flat[`acc_${n}`] = slot.accuracyPct;
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
  const first = row.slots[0].accuracyPct;
  const last = row.slots[row.slots.length - 1].accuracyPct;
  if (first == null || last == null) return null;
  const delta = last - first;
  const sign = delta >= 0 ? '+' : '';
  return `#${row.slots[0].iterationNumber} → #${row.slots[row.slots.length - 1].iterationNumber}: ${sign}${delta.toFixed(1)} pts accuracy`;
}
