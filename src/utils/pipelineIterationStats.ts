import type { DataSource } from '../context/ReadingsContext';
import type { S3MeterReading, PipelineIterationPortalStats, PipelineIterationRecord } from '../services/api';
import type { WorkType } from '../types';

function normalizeReadingAppVersion(r: S3MeterReading): string {
  const raw =
    r.appVersion != null && String(r.appVersion).trim() !== '' ? String(r.appVersion).trim() : 'unknown';
  return raw;
}

function normalizeConfidenceScalar(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1 && raw <= 100) return raw / 100;
    if (raw >= 0 && raw <= 1) return raw;
    return undefined;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return undefined;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return undefined;
    if (n > 1 && n <= 100) return n / 100;
    if (n >= 0 && n <= 1) return n;
    return undefined;
  }
  return undefined;
}

function avgConfidence(readings: S3MeterReading[]): number | null {
  let sum = 0;
  let n = 0;
  for (const r of readings) {
    const c = normalizeConfidenceScalar(r.confidence);
    if (c !== undefined) {
      sum += c;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

function queueCorrectRatePct(readings: S3MeterReading[]): number | null {
  if (!readings.length) return null;
  const c = readings.filter((r) => r.status === 'correct').length;
  return (c / readings.length) * 100;
}

/** Per-dial digit match % where expected vs model reading (digits only). */
function digitMatchStats(readings: S3MeterReading[]): {
  overallPct: number | null;
  dial1: number | null;
  dial2: number | null;
  dial3: number | null;
  dial4: number | null;
} {
  const correct = [0, 0, 0, 0];
  const total = [0, 0, 0, 0];
  for (const r of readings) {
    const exp = String(r.expectedValue ?? '').replace(/\D/g, '');
    const pred = String(r.meterValue ?? '').replace(/\D/g, '');
    if (!exp || !pred) continue;
    const len = Math.min(4, exp.length, pred.length);
    for (let i = 0; i < len; i++) {
      total[i] += 1;
      if (exp[i] === pred[i]) correct[i] += 1;
    }
  }
  const dial = (i: number): number | null =>
    total[i] > 0 ? (correct[i] / total[i]) * 100 : null;
  const d1 = dial(0);
  const d2 = dial(1);
  const d3 = dial(2);
  const d4 = dial(3);
  const rates = [d1, d2, d3, d4].filter((x): x is number => x != null);
  const overallPct =
    rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  return { overallPct, dial1: d1, dial2: d2, dial3: d3, dial4: d4 };
}

/**
 * Aggregate portal session/image and proxy accuracy metrics for one `app_version`
 * (same scope as dashboard readings list: current work type + data source).
 */
export function computePortalStatsForAppVersion(
  readings: S3MeterReading[],
  appVersion: string,
  workType: WorkType,
  dataSource: DataSource,
): PipelineIterationPortalStats | null {
  const target = appVersion.trim() || 'unknown';
  const scoped =
    dataSource === 'all' ? readings : readings.filter((r) => r.type === dataSource);
  const match = scoped.filter((r) => normalizeReadingAppVersion(r) === target);
  if (!match.length) return null;

  let totalImages = 0;
  const sim: S3MeterReading[] = [];
  const fld: S3MeterReading[] = [];
  for (const r of match) {
    totalImages += Array.isArray(r.images) ? r.images.length : 0;
    if (r.type === 'simulator') sim.push(r);
    else fld.push(r);
  }

  const simImg = sim.reduce((s, r) => s + (Array.isArray(r.images) ? r.images.length : 0), 0);
  const fldImg = fld.reduce((s, r) => s + (Array.isArray(r.images) ? r.images.length : 0), 0);

  const utDigits = digitMatchStats(sim);
  const ftDigits = digitMatchStats(fld);

  return {
    pulledAt: new Date().toISOString(),
    workType,
    dataSource,
    totalSessions: match.length,
    totalImages,
    simulatorSessions: sim.length,
    simulatorImages: simImg,
    fieldSessions: fld.length,
    fieldImages: fldImg,
    avgSessionConfidence: avgConfidence(match),
    queueCorrectRateAll: queueCorrectRatePct(match),
    queueCorrectRateSimulator: sim.length ? queueCorrectRatePct(sim) : null,
    queueCorrectRateField: fld.length ? queueCorrectRatePct(fld) : null,
    digitMatchUtPct: utDigits.overallPct,
    dial1UtPct: utDigits.dial1,
    dial2UtPct: utDigits.dial2,
    dial3UtPct: utDigits.dial3,
    dial4UtPct: utDigits.dial4,
    digitMatchFtPct: ftDigits.overallPct,
    dial1FtPct: ftDigits.dial1,
    dial2FtPct: ftDigits.dial2,
    dial3FtPct: ftDigits.dial3,
    dial4FtPct: ftDigits.dial4,
  };
}

export function uniqueAppVersionsFromReadings(readings: S3MeterReading[]): string[] {
  const s = new Set<string>();
  for (const r of readings) {
    s.add(normalizeReadingAppVersion(r));
  }
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Single Y-value for registry trend charts: admin exact % → manual UT read acc → portal sim queue → portal all-queue.
 */
export function effectiveIterationAccuracyPercent(r: PipelineIterationRecord): number | null {
  const m = r.manualMetrics;
  if (m?.exactReadingAccuracyPct != null && Number.isFinite(m.exactReadingAccuracyPct)) {
    return m.exactReadingAccuracyPct;
  }
  if (m?.readAccuracyUt != null && Number.isFinite(m.readAccuracyUt)) return m.readAccuracyUt;
  const ps = r.portalStats;
  if (ps?.queueCorrectRateSimulator != null && Number.isFinite(ps.queueCorrectRateSimulator)) {
    return ps.queueCorrectRateSimulator;
  }
  if (ps?.queueCorrectRateAll != null && Number.isFinite(ps.queueCorrectRateAll)) {
    return ps.queueCorrectRateAll;
  }
  return null;
}
