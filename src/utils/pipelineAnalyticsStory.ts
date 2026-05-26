import type { PipelineIterationRecord } from '../services/api';
import type { FactoryProductLine } from '../constants/factoryStages';
import { inferProductLineForRow } from '../constants/factoryStages';
import {
  FACTORY_PRODUCT_LINE_CHART,
  filterEvalChartRows,
  PIPELINE_CHART_LINES,
  evalAccuracyPct,
  perDialMetricsFromRow,
  readAccuracyPct,
  readConfidencePct,
  type ChartPipelineFilter,
  type LatestDialAppMetric,
} from '../constants/pipelineChartTheme';
import { formatUnitTestResultsSummary } from './unitTestDisplayLabels';

export type MetricDelta = {
  value: number | null;
  previous: number | null;
  delta: number | null;
  first: number | null;
  deltaVsFirst: number | null;
  latestIteration: number | null;
  previousIteration: number | null;
  firstIteration: number | null;
};

export type CurrentScopeSummary = {
  totalTrainingImages: number | null;
  totalUnitTestImages: number | null;
  pipelineCount: number;
  iterationCount: number;
};

export type ProjectSnapshotCard = {
  id: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  label: string;
  stroke: string;
  fillMuted: string;
  row: PipelineIterationRecord;
  pipelineName: string;
  iterationNumber: number;
  appVersion: string;
  modelId: string;
  startDate: string | null;
  status: string | null;
  outcome: string | null;
  imagesAddedSinceLast: number | null;
  evalDate: string | null;
  isLatest: boolean;
  readAccuracyPct: number | null;
  readConfidencePct: number | null;
  exactReadingPct: number | null;
  trainingImages: number | null;
  unitTestImages: number | null;
  hasLinkedCsv: boolean;
  linkedCsvName: string | null;
  scopeNote: string | null;
  perDial: LatestDialAppMetric[];
  accuracyTrend: MetricDelta;
  confidenceTrend: MetricDelta;
};

export type LineTrendSummary = {
  line: Exclude<FactoryProductLine, 'unknown'>;
  label: string;
  stroke: string;
  latestIteration: number;
  latestValue: number | null;
  previousIteration: number | null;
  previousValue: number | null;
  deltaVsPrevious: number | null;
  firstIteration: number | null;
  firstValue: number | null;
  deltaVsFirst: number | null;
};

export type ReportSummaryRow = {
  id: string;
  pipeline: string;
  line: Exclude<FactoryProductLine, 'unknown'>;
  iterationNumber: number;
  appVersion: string;
  readAccuracyPct: number | null;
  readConfidencePct: number | null;
  exactReadingPct: number | null;
  trainingImages: number | null;
  unitTestImages: number | null;
  hasLinkedCsv: boolean;
  scopeNote: string | null;
};

export type ReportIterationDetail = ReportSummaryRow & {
  perDial: LatestDialAppMetric[];
  outcome: string | null;
  linkedCsvName: string | null;
  accuracyDelta: number | null;
  confidenceDelta: number | null;
};

function lineRows(
  rows: PipelineIterationRecord[],
  line: Exclude<FactoryProductLine, 'unknown'>,
): PipelineIterationRecord[] {
  return filterEvalChartRows(rows)
    .filter((r) => inferProductLineForRow(r) === line)
    .sort((a, b) => a.iterationNumber - b.iterationNumber);
}

function metricForRow(
  row: PipelineIterationRecord,
  metric: 'accuracy' | 'confidence' | 'images' | 'exact',
): number | null {
  if (metric === 'images') {
    const n = row.imageCount ?? row.portalStats?.totalImages ?? null;
    return n != null && Number.isFinite(n) ? n : null;
  }
  if (metric === 'exact') return evalAccuracyPct(row);
  return metric === 'accuracy' ? readAccuracyPct(row) : readConfidencePct(row);
}

function buildMetricDelta(
  sortedRows: PipelineIterationRecord[],
  metric: 'accuracy' | 'confidence',
): MetricDelta {
  const values = sortedRows
    .map((r) => ({
      iter: r.iterationNumber,
      v: metricForRow(r, metric),
    }))
    .filter((x) => x.v != null);

  if (!values.length) {
    return {
      value: null,
      previous: null,
      delta: null,
      first: null,
      deltaVsFirst: null,
      latestIteration: null,
      previousIteration: null,
      firstIteration: null,
    };
  }

  const latest = values[values.length - 1]!;
  const prev = values.length >= 2 ? values[values.length - 2]! : null;
  const first = values[0]!;

  const delta =
    latest.v != null && prev?.v != null
      ? Math.round((latest.v - prev.v) * 10) / 10
      : null;
  const deltaVsFirst =
    latest.v != null && first.v != null
      ? Math.round((latest.v - first.v) * 10) / 10
      : null;

  return {
    value: latest.v,
    previous: prev?.v ?? null,
    delta,
    first: first.v,
    deltaVsFirst,
    latestIteration: latest.iter,
    previousIteration: prev?.iter ?? null,
    firstIteration: first.iter,
  };
}

/** Latest eval row for a product line — prefers highest iteration with linked unit-test CSV. */
export function resolveLatestEvalRowForLine(
  rows: PipelineIterationRecord[],
  line: Exclude<FactoryProductLine, 'unknown'>,
): PipelineIterationRecord | null {
  const list = lineRows(rows, line);
  if (!list.length) return null;

  const withCsv = [...list]
    .reverse()
    .find((r) => (r.linkedUnitTests?.length ?? 0) > 0);
  if (withCsv) return withCsv;

  return list[list.length - 1] ?? null;
}

function evalDateForRow(row: PipelineIterationRecord): string | null {
  const links = row.linkedUnitTests ?? [];
  if (links.length) {
    const sorted = [...links].sort((a, b) => {
      const ta = Date.parse(a.generatedUtc || a.linkedAt || '') || 0;
      const tb = Date.parse(b.generatedUtc || b.linkedAt || '') || 0;
      return tb - ta;
    });
    const utc = sorted[0]?.generatedUtc?.trim();
    if (utc) {
      try {
        return new Date(utc).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return utc;
      }
    }
  }
  const start = row.startDate?.trim();
  if (start) return start;
  return null;
}

function linkedResultsLabel(row: PipelineIterationRecord): string | null {
  const links = row.linkedUnitTests ?? [];
  if (!links.length) return null;
  const sorted = [...links].sort((a, b) => {
    const ta = Date.parse(a.generatedUtc || a.linkedAt || '') || 0;
    const tb = Date.parse(b.generatedUtc || b.linkedAt || '') || 0;
    return tb - ta;
  });
  const link = sorted[0];
  if (!link) return null;
  return formatUnitTestResultsSummary({
    pipelineDisplayName: link.pipelineDisplayName,
    pipelineId: link.pipelineId,
    generatedUtc: link.generatedUtc,
    accuracyPercent: link.accuracyPercent,
    imagesProcessed: link.imagesProcessed,
  });
}

function buildSnapshotCardForRow(
  row: PipelineIterationRecord,
  line: Exclude<FactoryProductLine, 'unknown'>,
  sortedLineRows: PipelineIterationRecord[],
  isLatest: boolean,
): ProjectSnapshotCard {
  const theme = FACTORY_PRODUCT_LINE_CHART[line];
  const perDial = perDialMetricsFromRow(row).map((d, i) => ({
    dial: i + 1,
    accuracy: d.appAcc,
    confidence: d.appConf,
  }));

  const accuracyTrend = isLatest
    ? buildMetricDelta(sortedLineRows, 'accuracy')
    : buildMetricDeltaThroughRow(sortedLineRows, row, 'accuracy');
  const confidenceTrend = isLatest
    ? buildMetricDelta(sortedLineRows, 'confidence')
    : buildMetricDeltaThroughRow(sortedLineRows, row, 'confidence');

  return {
    id: row.id,
    line,
    label: theme.label,
    stroke: theme.stroke,
    fillMuted: theme.fillMuted,
    row,
    pipelineName: row.pipeline.trim(),
    iterationNumber: row.iterationNumber,
    appVersion: row.appVersion.trim() || '—',
    modelId: row.modelId?.trim() || '—',
    startDate: row.startDate?.trim() || null,
    status: row.currentStatus?.trim() || null,
    outcome: row.outcome?.trim() || null,
    imagesAddedSinceLast:
      row.imagesAddedSinceLastIteration != null && Number.isFinite(row.imagesAddedSinceLastIteration)
        ? row.imagesAddedSinceLastIteration
        : null,
    evalDate: evalDateForRow(row),
    isLatest,
    readAccuracyPct: readAccuracyPct(row),
    readConfidencePct: readConfidencePct(row),
    exactReadingPct: evalAccuracyPct(row),
    trainingImages: metricForRow(row, 'images'),
    unitTestImages: row.manualMetrics?.unitTestImagesLaptop ?? null,
    hasLinkedCsv: (row.linkedUnitTests?.length ?? 0) > 0,
    linkedCsvName: linkedResultsLabel(row),
    scopeNote: row.scope?.trim() || null,
    perDial,
    accuracyTrend,
    confidenceTrend,
  };
}

/** Metric deltas ending at a specific iteration (for historical cards). */
function buildMetricDeltaThroughRow(
  sortedRows: PipelineIterationRecord[],
  row: PipelineIterationRecord,
  metric: 'accuracy' | 'confidence',
): MetricDelta {
  const idx = sortedRows.findIndex((r) => r.id === row.id);
  if (idx < 0) {
    return {
      value: null,
      previous: null,
      delta: null,
      first: null,
      deltaVsFirst: null,
      latestIteration: null,
      previousIteration: null,
      firstIteration: null,
    };
  }
  return buildMetricDelta(sortedRows.slice(0, idx + 1), metric);
}

export function buildProjectSnapshots(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
): ProjectSnapshotCard[] {
  const lines =
    pipelineFilter === 'all'
      ? PIPELINE_CHART_LINES
      : [pipelineFilter as Exclude<FactoryProductLine, 'unknown'>];

  const cards: ProjectSnapshotCard[] = [];

  for (const line of lines) {
    const sorted = lineRows(rows, line);
    const row = resolveLatestEvalRowForLine(rows, line);
    if (!row) continue;
    cards.push(buildSnapshotCardForRow(row, line, sorted, true));
  }

  return cards;
}

/** Current tab: latest eval snapshot for the active pipeline filter (one card when filter is all). */
export function buildCurrentSnapshots(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
): ProjectSnapshotCard[] {
  const cards = buildProjectSnapshots(rows, pipelineFilter);
  if (pipelineFilter !== 'all' || cards.length <= 1) return cards;

  const newest = [...cards].sort((a, b) => {
    const da = Date.parse(a.evalDate ?? '') || 0;
    const db = Date.parse(b.evalDate ?? '') || 0;
    if (da !== db) return db - da;
    return b.iterationNumber - a.iterationNumber;
  })[0];
  return newest ? [newest] : [];
}

/** Latest eval row per visible pipeline line (for trainer / compact views). */
export function latestEvalRowsForPipelineFilter(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
): PipelineIterationRecord[] {
  const lines =
    pipelineFilter === 'all'
      ? PIPELINE_CHART_LINES
      : [pipelineFilter as Exclude<FactoryProductLine, 'unknown'>];

  return lines
    .map((line) => resolveLatestEvalRowForLine(rows, line))
    .filter((r): r is PipelineIterationRecord => r != null);
}

/** All eval iterations for one pipeline line, newest first. */
export function buildLineIterationSnapshots(
  rows: PipelineIterationRecord[],
  line: Exclude<FactoryProductLine, 'unknown'>,
): ProjectSnapshotCard[] {
  const sorted = lineRows(rows, line);
  if (!sorted.length) return [];
  const latestRow = resolveLatestEvalRowForLine(rows, line);
  const latestId = latestRow?.id ?? sorted[sorted.length - 1]?.id;
  return [...sorted]
    .reverse()
    .map((row) => buildSnapshotCardForRow(row, line, sorted, row.id === latestId));
}

/** Aggregate totals for the Current tab — sums latest eval snapshot per visible pipeline. */
export function buildCurrentScopeSummary(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
): CurrentScopeSummary {
  const cards = buildProjectSnapshots(rows, pipelineFilter);
  let trainingSum = 0;
  let hasTraining = false;
  let utSum = 0;
  let hasUt = false;

  for (const card of cards) {
    if (card.trainingImages != null) {
      trainingSum += card.trainingImages;
      hasTraining = true;
    }
    if (card.unitTestImages != null) {
      utSum += card.unitTestImages;
      hasUt = true;
    }
  }

  const evalRows = filterEvalChartRows(rows);
  const iterationCount =
    pipelineFilter === 'all'
      ? evalRows.length
      : evalRows.filter((r) => inferProductLineForRow(r) === pipelineFilter).length;

  return {
    totalTrainingImages: hasTraining ? trainingSum : null,
    totalUnitTestImages: hasUt ? utSum : null,
    pipelineCount: cards.length,
    iterationCount,
  };
}

export function buildLineTrendSummaries(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter,
  metric: 'images' | 'accuracy' | 'confidence',
): LineTrendSummary[] {
  const lines =
    pipelineFilter === 'all'
      ? PIPELINE_CHART_LINES
      : [pipelineFilter as Exclude<FactoryProductLine, 'unknown'>];

  const key =
    metric === 'images' ? 'images' : metric === 'accuracy' ? 'accuracy' : 'confidence';

  const out: LineTrendSummary[] = [];

  for (const line of lines) {
    const sorted = lineRows(rows, line);
    const points = sorted
      .map((r) => ({
        iteration: r.iterationNumber,
        value: metricForRow(r, key),
      }))
      .filter((p) => p.value != null);

    if (!points.length) continue;

    const latest = points[points.length - 1]!;
    const prev = points.length >= 2 ? points[points.length - 2]! : null;
    const first = points[0]!;
    const theme = FACTORY_PRODUCT_LINE_CHART[line];

    out.push({
      line,
      label: theme.label,
      stroke: theme.stroke,
      latestIteration: latest.iteration,
      latestValue: latest.value,
      previousIteration: prev?.iteration ?? null,
      previousValue: prev?.value ?? null,
      deltaVsPrevious:
        latest.value != null && prev?.value != null
          ? Math.round((latest.value - prev.value) * 10) / 10
          : null,
      firstIteration: first.iteration,
      firstValue: first.value,
      deltaVsFirst:
        latest.value != null && first.value != null
          ? Math.round((latest.value - first.value) * 10) / 10
          : null,
    });
  }

  return out;
}

export function buildReportSummaryRows(
  rows: PipelineIterationRecord[],
): ReportSummaryRow[] {
  return filterEvalChartRows(rows)
    .sort((a, b) => {
      const la = PIPELINE_CHART_LINES.indexOf(
        inferProductLineForRow(a) as Exclude<FactoryProductLine, 'unknown'>,
      );
      const lb = PIPELINE_CHART_LINES.indexOf(
        inferProductLineForRow(b) as Exclude<FactoryProductLine, 'unknown'>,
      );
      if (la !== lb) return la - lb;
      return a.iterationNumber - b.iterationNumber;
    })
    .map((r) => ({
      id: r.id,
      pipeline: r.pipeline.trim(),
      line: inferProductLineForRow(r) as Exclude<FactoryProductLine, 'unknown'>,
      iterationNumber: r.iterationNumber,
      appVersion: r.appVersion.trim() || '—',
      readAccuracyPct: readAccuracyPct(r),
      readConfidencePct: readConfidencePct(r),
      exactReadingPct: evalAccuracyPct(r),
      trainingImages: metricForRow(r, 'images'),
      unitTestImages: r.manualMetrics?.unitTestImagesLaptop ?? null,
      hasLinkedCsv: (r.linkedUnitTests?.length ?? 0) > 0,
      scopeNote: r.scope?.trim() || null,
    }));
}

export function buildReportIterationDetails(
  rows: PipelineIterationRecord[],
  allRowsForDelta?: PipelineIterationRecord[],
): ReportIterationDetail[] {
  const byLine = new Map<string, PipelineIterationRecord[]>();
  for (const r of filterEvalChartRows(allRowsForDelta ?? rows)) {
    const line = inferProductLineForRow(r);
    const list = byLine.get(line) ?? [];
    list.push(r);
    byLine.set(line, list);
  }

  return buildReportSummaryRows(rows).map((summary) => {
    const row = rows.find((r) => r.id === summary.id);
    const lineList = (byLine.get(summary.line) ?? []).sort(
      (a, b) => a.iterationNumber - b.iterationNumber,
    );
    const idx = lineList.findIndex((r) => r.id === summary.id);
    const prev = idx > 0 ? lineList[idx - 1] : null;

    const perDial = row
      ? perDialMetricsFromRow(row).map((d, i) => ({
          dial: i + 1,
          accuracy: d.appAcc,
          confidence: d.appConf,
        }))
      : [1, 2, 3, 4].map((dial) => ({ dial, accuracy: null, confidence: null }));

    const acc = summary.readAccuracyPct;
    const prevAcc = prev ? readAccuracyPct(prev) : null;
    const conf = summary.readConfidencePct;
    const prevConf = prev ? readConfidencePct(prev) : null;

    return {
      ...summary,
      perDial,
      outcome: row?.outcome?.trim() || null,
      linkedCsvName: row ? linkedResultsLabel(row) : null,
      accuracyDelta:
        acc != null && prevAcc != null ? Math.round((acc - prevAcc) * 10) / 10 : null,
      confidenceDelta:
        conf != null && prevConf != null ? Math.round((conf - prevConf) * 10) / 10 : null,
    };
  });
}

/** Format delta for display: "+4.2 pp" or "—" */
export function formatDeltaPp(delta: number | null | undefined, unit = 'pp'): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  if (unit === '') {
    return `${sign}${Math.abs(delta) >= 100 ? delta.toLocaleString() : delta.toFixed(1)}`;
  }
  return `${sign}${delta.toFixed(1)} ${unit}`;
}

export function deltaTone(delta: number | null | undefined): 'up' | 'down' | 'flat' | 'none' {
  if (delta == null || !Number.isFinite(delta)) return 'none';
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'flat';
}
