import type { PipelineIterationManualMetrics, PipelineIterationRecord } from '../services/api';
import {
  evalAccuracyPct,
  readAccuracyPct,
  readConfidencePct,
  simAccuracyPct,
  simConfidencePct,
  simReadGapPct,
} from '../constants/pipelineChartTheme';
import { normalizeManualMetricPct } from './metricNumbers';
import { roundPortalAccuracyConfidencePct } from './portalMetricFormat';

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function meanNormalized(values: unknown[]): number | null {
  const nums = values.map(normalizeManualMetricPct).filter((v): v is number => v != null);
  return mean(nums);
}

export function avgSimDialConfidencePct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([
    m.simDial1ConfidencePct,
    m.simDial2ConfidencePct,
    m.simDial3ConfidencePct,
    m.simDial4ConfidencePct,
  ]);
}

export function avgAppDialConfidencePct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([
    m.appDial1ConfidencePct,
    m.appDial2ConfidencePct,
    m.appDial3ConfidencePct,
    m.appDial4ConfidencePct,
  ]);
}

export function avgSimDialAccuracyPct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([
    m.simDial1AccuracyPct,
    m.simDial2AccuracyPct,
    m.simDial3AccuracyPct,
    m.simDial4AccuracyPct,
  ]);
}

export function avgAppDialAccuracyPct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([
    m.appDial1AccuracyPct,
    m.appDial2AccuracyPct,
    m.appDial3AccuracyPct,
    m.appDial4AccuracyPct,
  ]);
}

export function avgUtDialAccuracyPct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([m.dial1UtPct, m.dial2UtPct, m.dial3UtPct, m.dial4UtPct]);
}

export function avgFtDialAccuracyPct(m: PipelineIterationManualMetrics | null | undefined): number | null {
  if (!m) return null;
  return meanNormalized([m.dial1FtPct, m.dial2FtPct, m.dial3FtPct, m.dial4FtPct]);
}

function pipelineFamily(pipeline: string): string {
  const p = pipeline.trim().toLowerCase();
  if (p.includes('sempra') && p.includes('anica')) return 'combined';
  if (p.includes('sempra')) return 'sempra';
  if (p.includes('anica')) return 'anica';
  return p;
}

export function hasUtMetrics(m: PipelineIterationManualMetrics | null | undefined): boolean {
  if (!m) return false;
  return [m.dial1UtPct, m.dial2UtPct, m.dial3UtPct, m.dial4UtPct, m.readAccuracyUt].some(
    (v) => v != null && Number.isFinite(v),
  );
}

export function hasFtMetrics(m: PipelineIterationManualMetrics | null | undefined): boolean {
  if (!m) return false;
  return [m.dial1FtPct, m.dial2FtPct, m.dial3FtPct, m.dial4FtPct, m.readAccuracyFtRow].some(
    (v) => v != null && Number.isFinite(v),
  );
}

/** Scale dial metrics; returns partial patch. */
function scaleDialPatch(
  source: PipelineIterationManualMetrics,
  factor: number,
  kind: 'ut' | 'ft',
): Partial<PipelineIterationManualMetrics> {
  const scale = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? roundPortalAccuracyConfidencePct(v * factor) : null;
  if (kind === 'ut') {
    return {
      readAccuracyUt: scale(source.readAccuracyUt),
      dial1UtPct: scale(source.dial1UtPct),
      dial2UtPct: scale(source.dial2UtPct),
      dial3UtPct: scale(source.dial3UtPct),
      dial4UtPct: scale(source.dial4UtPct),
    };
  }
  return {
    readAccuracyFtRow: scale(source.readAccuracyFtRow),
    dial1FtPct: scale(source.dial1FtPct),
    dial2FtPct: scale(source.dial2FtPct),
    dial3FtPct: scale(source.dial3FtPct),
    dial4FtPct: scale(source.dial4FtPct),
  };
}

/**
 * Fill missing UT/FT/exact % on earlier iterations using the best row in the same pipeline family.
 * Earlier iterations get ~2% lower UT and ~3% lower FT than the reference row (conservative estimate).
 */
export function enrichIterationManualMetrics(
  row: PipelineIterationRecord,
  allRows: PipelineIterationRecord[],
): PipelineIterationManualMetrics {
  const base = { ...(row.manualMetrics ?? {}) };
  const family = pipelineFamily(row.pipeline);

  const familyRows = allRows
    .filter((r) => pipelineFamily(r.pipeline) === family)
    .sort((a, b) => b.iterationNumber - a.iterationNumber);

  const refUt = familyRows.find((r) => hasUtMetrics(r.manualMetrics));
  const refFt = familyRows.find((r) => hasFtMetrics(r.manualMetrics));

  const iterGap = refUt ? Math.max(0, (refUt.iterationNumber ?? 1) - row.iterationNumber) : 0;
  const utFactor = iterGap > 0 ? 0.98 ** iterGap : 1;
  const ftFactor = iterGap > 0 ? 0.97 ** iterGap : 1;

  if (refUt?.manualMetrics && !hasUtMetrics(base)) {
    Object.assign(base, scaleDialPatch(refUt.manualMetrics, utFactor, 'ut'));
    if (base.readAccuracyUt == null) {
      const avg = avgUtDialAccuracyPct(base);
      if (avg != null) base.readAccuracyUt = roundPortalAccuracyConfidencePct(avg);
    }
  }

  if (refFt?.manualMetrics && !hasFtMetrics(base)) {
    Object.assign(base, scaleDialPatch(refFt.manualMetrics, ftFactor, 'ft'));
    if (base.readAccuracyFtRow == null) {
      const avg = avgFtDialAccuracyPct(base);
      if (avg != null) base.readAccuracyFtRow = roundPortalAccuracyConfidencePct(avg);
    }
  }

  if (base.exactReadingAccuracyPct == null || !Number.isFinite(base.exactReadingAccuracyPct)) {
    const ut = base.readAccuracyUt ?? avgUtDialAccuracyPct(base);
    const sim = avgSimDialConfidencePct(base);
    if (ut != null) base.exactReadingAccuracyPct = roundPortalAccuracyConfidencePct(ut * 0.98);
    else if (sim != null) base.exactReadingAccuracyPct = roundPortalAccuracyConfidencePct(sim * 0.9);
  }

  return base;
}

/** True when UT/FT on this row were filled from a later iteration in the same pipeline. */
export function isEstimatedEvalMetrics(
  row: PipelineIterationRecord,
  sourceRows: PipelineIterationRecord[],
): boolean {
  const raw = sourceRows.find((r) => r.id === row.id);
  if (!raw) return false;
  const enriched = enrichIterationManualMetrics(row, sourceRows);
  const hadUt = hasUtMetrics(raw.manualMetrics);
  const hadFt = hasFtMetrics(raw.manualMetrics);
  const hasUtNow = hasUtMetrics(enriched);
  const hasFtNow = hasFtMetrics(enriched);
  return (!hadUt && hasUtNow) || (!hadFt && hasFtNow);
}

export function enrichIterationRegistryRows(rows: PipelineIterationRecord[]): PipelineIterationRecord[] {
  return rows.map((r) => ({
    ...r,
    manualMetrics: enrichIterationManualMetrics(r, rows),
  }));
}

export function sortIterationsChronologically(rows: PipelineIterationRecord[]): PipelineIterationRecord[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.startDate || 0).getTime();
    const tb = new Date(b.startDate || 0).getTime();
    if (ta !== tb) return ta - tb;
    return a.iterationNumber - b.iterationNumber;
  });
}

/** Latest completed iteration with sim vs read metrics (for dashboard KPI strip). */
export function latestIterationKpis(rows: PipelineIterationRecord[]): {
  simConfidencePct: number | null;
  readConfidencePct: number | null;
  simAccuracyPct: number | null;
  readAccuracyPct: number | null;
  confGapPct: number | null;
  accGapPct: number | null;
  exactReadingPct: number | null;
  label: string | null;
} {
  const enriched = enrichIterationRegistryRows(rows);
  const completed = sortIterationsChronologically(enriched).filter(
    (r) => String(r.currentStatus).toLowerCase() === 'completed',
  );
  const latest = completed[completed.length - 1];
  if (!latest) {
    return {
      simConfidencePct: null,
      readConfidencePct: null,
      simAccuracyPct: null,
      readAccuracyPct: null,
      confGapPct: null,
      accGapPct: null,
      exactReadingPct: null,
      label: null,
    };
  }

  const simConf = simConfidencePct(latest);
  const readConf = readConfidencePct(latest);
  const simAcc = simAccuracyPct(latest);
  const readAcc = readAccuracyPct(latest);

  return {
    simConfidencePct: simConf,
    readConfidencePct: readConf,
    simAccuracyPct: simAcc,
    readAccuracyPct: readAcc,
    confGapPct: simReadGapPct(readConf, simConf),
    accGapPct: simReadGapPct(readAcc, simAcc),
    exactReadingPct: evalAccuracyPct(latest),
    label: `${latest.pipeline.trim()} · #${latest.iterationNumber}`,
  };
}
