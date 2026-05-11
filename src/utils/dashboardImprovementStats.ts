import type { S3MeterReading } from '../services/api';
import type { ReadingStatus } from '../types';

/** Sessions past initial incorrect — reviewer / labeler / training path. */
const TRAINING_FUNNEL_STATUSES: ReadingStatus[] = [
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
];

/** Same rules as ReadingsList / pipeline stats: metadata may be 0–1 or 0–100. */
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

/**
 * Full-reading digit agreement: model `meterValue` vs human `expectedValue` (digits only).
 * Null when either side is missing — clearer “accuracy” story than per-dial slices alone.
 */
export function sessionModelVsCorrectionPct(r: S3MeterReading): number | null {
  const exp = String(r.expectedValue ?? '').replace(/\D/g, '');
  const pred = String(r.meterValue ?? '').replace(/\D/g, '');
  if (!exp || !pred) return null;
  const len = Math.min(4, exp.length, pred.length);
  if (len === 0) return null;
  let match = 0;
  for (let i = 0; i < len; i++) {
    if (exp[i] === pred[i]) match += 1;
  }
  return (match / len) * 100;
}

function mondayOfWeekContaining(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00`);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

export function binKeyForReading(dateOfReading: string | undefined, bucket: 'day' | 'week'): string {
  const day = (dateOfReading || '').split('T')[0];
  if (!day) return '';
  return bucket === 'week' ? mondayOfWeekContaining(day) : day;
}

export type ImprovementStoryBin = {
  date: string;
  drillIso: string;
  barLabel?: string;
  totalSessions: number;
  totalImages: number;
  /** Mean session confidence (metadata), 0–100; `confidenceSessions` = rows with a value */
  avgConfidencePct: number | null;
  confidenceSessions: number;
  /** Mean model reading vs correction (digits), sessions with both meter + expected */
  modelVsCorrectionPct: number | null;
  modelVsCorrectionSessions: number;
  awaitingReview: number;
  inTrainingFunnel: number;
};

function improvementBinFromSessions(
  id: string,
  drillKey: string,
  barLabel: string | undefined,
  list: S3MeterReading[],
): ImprovementStoryBin {
  let totalImages = 0;
  let sumConf = 0;
  let confN = 0;
  let modelSum = 0;
  let modelN = 0;
  let awaitingReview = 0;
  let inTrainingFunnel = 0;

  for (const r of list) {
    totalImages += Array.isArray(r.images) ? r.images.length : 0;
    const c = normalizeConfidenceScalar(r.confidence);
    if (c !== undefined) {
      sumConf += c;
      confN += 1;
    }
    const m = sessionModelVsCorrectionPct(r);
    if (m != null) {
      modelSum += m;
      modelN += 1;
    }
    if (r.status === 'incorrect_new') awaitingReview += 1;
    if (TRAINING_FUNNEL_STATUSES.includes(r.status as ReadingStatus)) inTrainingFunnel += 1;
  }

  const n = list.length;
  const avgConfidencePct = confN > 0 ? (sumConf / confN) * 100 : null;
  const modelVsCorrectionPct = modelN > 0 ? modelSum / modelN : null;

  return {
    date: id,
    drillIso: drillKey,
    barLabel,
    totalSessions: n,
    totalImages,
    avgConfidencePct,
    confidenceSessions: confN,
    modelVsCorrectionPct,
    modelVsCorrectionSessions: modelN,
    awaitingReview,
    inTrainingFunnel,
  };
}

export function normalizeReadingAppVersion(r: S3MeterReading): string {
  return r.appVersion != null && String(r.appVersion).trim() !== '' ? String(r.appVersion).trim() : 'unknown';
}

/** Earliest upload day (yyyy-mm-dd) in a group; empty string if none. */
function earliestUploadDay(readings: S3MeterReading[]): string {
  let min = '';
  for (const r of readings) {
    const d = (r.dateOfReading || '').split('T')[0];
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

/**
 * One bin per `app_version` (metadata). X-order: **ascending by first-seen upload date** (oldest left → newest
 * right), then `app_version` string. Caps how many versions appear; when over the cap, keeps the **most recent**
 * versions by first-seen date (still sorted oldest→newest among those).
 */
export function buildImprovementStoryBinsByAppVersion(
  readings: S3MeterReading[],
  options?: { maxVersions?: number },
): ImprovementStoryBin[] {
  const maxV = options?.maxVersions ?? 16;
  const groups = new Map<string, S3MeterReading[]>();
  for (const r of readings) {
    const v = normalizeReadingAppVersion(r);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(r);
  }

  type Row = { appVersion: string; list: S3MeterReading[]; firstDay: string };
  const rows: Row[] = [...groups.entries()].map(([appVersion, list]) => ({
    appVersion,
    list,
    firstDay: earliestUploadDay(list),
  }));

  rows.sort((a, b) => {
    if (a.firstDay && b.firstDay && a.firstDay !== b.firstDay) {
      return a.firstDay.localeCompare(b.firstDay);
    }
    if (a.firstDay && !b.firstDay) return -1;
    if (!a.firstDay && b.firstDay) return 1;
    if (a.appVersion === 'unknown' && b.appVersion !== 'unknown') return 1;
    if (a.appVersion !== 'unknown' && b.appVersion === 'unknown') return -1;
    return a.appVersion.localeCompare(b.appVersion, undefined, { numeric: true });
  });

  const capped = rows.length <= maxV ? rows : rows.slice(-maxV);

  return capped.map(({ appVersion, list }) =>
    improvementBinFromSessions(
      appVersion,
      appVersion,
      appVersion === 'unknown' ? 'unknown' : appVersion,
      list,
    ),
  );
}

export function buildImprovementStoryBins(
  readings: S3MeterReading[],
  bucket: 'day' | 'week',
  volumeBins: { date: string; drillIso: string; barLabel?: string }[],
): ImprovementStoryBin[] {
  const groups = new Map<string, S3MeterReading[]>();
  for (const r of readings) {
    const k = binKeyForReading(r.dateOfReading, bucket);
    if (!k) continue;
    if (!volumeBins.some((b) => b.date === k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return volumeBins.map((bin) => {
    const list = groups.get(bin.date) ?? [];
    return improvementBinFromSessions(bin.date, bin.drillIso, bin.barLabel, list);
  });
}
