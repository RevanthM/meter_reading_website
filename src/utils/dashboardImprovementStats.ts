import type { S3MeterReading } from '../services/api';
import type { ReadingStatus } from '../types';
import {
  addPortalCalendarDays,
  calendarDayKeyInPortalTz,
  PORTAL_DISPLAY_TIME_ZONE,
  utcMillisForZonedPortalMidnight,
} from './readingDisplayDates';

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

/** 0–100 for display: session `confidence`, else minimum dial confidence (same idea as readings list). */
export function readingConfidencePct(r: S3MeterReading): number | null {
  const top = normalizeConfidenceScalar(r.confidence);
  if (top !== undefined) return top * 100;
  const dials = r.dialDetails;
  if (Array.isArray(dials) && dials.length > 0) {
    const nested = dials
      .map((d) => normalizeConfidenceScalar(d.confidence))
      .filter((n): n is number => n !== undefined);
    if (nested.length > 0) return Math.min(...nested) * 100;
  }
  return null;
}

/** Newest by `dateOfReading` (day); no-date last; tie-break `s3SessionPrefix` / `id`. */
export function pickLatestReadingByUploadDate(readings: S3MeterReading[]): S3MeterReading | null {
  if (readings.length === 0) return null;
  const tieKey = (x: S3MeterReading) => String(x.s3SessionPrefix ?? x.id ?? '');
  const sorted = [...readings].sort((a, b) => {
    const da = calendarDayKeyInPortalTz(a.dateOfReading || '');
    const db = calendarDayKeyInPortalTz(b.dateOfReading || '');
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    return tieKey(b).localeCompare(tieKey(a));
  });
  return sorted[0] ?? null;
}

/** Prefer a recent row that has confidence or accuracy so the strip is not blank when the newest row lacks metadata. */
export function pickLatestReadingPreferringMetrics(readings: S3MeterReading[]): S3MeterReading | null {
  if (readings.length === 0) return null;
  const tieKey = (x: S3MeterReading) => String(x.s3SessionPrefix ?? x.id ?? '');
  const sorted = [...readings].sort((a, b) => {
    const da = calendarDayKeyInPortalTz(a.dateOfReading || '');
    const db = calendarDayKeyInPortalTz(b.dateOfReading || '');
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    return tieKey(b).localeCompare(tieKey(a));
  });
  const usable = sorted.find(
    (r) => readingConfidencePct(r) !== null || sessionModelVsCorrectionPct(r) !== null,
  );
  return usable ?? sorted[0] ?? null;
}

function mondayOfWeekContaining(portalYmd: string): string {
  if (!portalYmd || !/^\d{4}-\d{2}-\d{2}$/.test(portalYmd)) return '';
  let ymd = portalYmd;
  for (let guard = 0; guard < 8; guard += 1) {
    const ms = utcMillisForZonedPortalMidnight(ymd);
    const probe = ms != null ? new Date(ms + 2 * 60 * 60 * 1000) : new Date(`${ymd}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: PORTAL_DISPLAY_TIME_ZONE,
      weekday: 'short',
    }).format(probe);
    if (weekday === 'Mon') return ymd;
    ymd = addPortalCalendarDays(ymd, -1);
  }
  return portalYmd;
}

export function binKeyForReading(dateOfReading: string | undefined, bucket: 'day' | 'week'): string {
  const day = calendarDayKeyInPortalTz(dateOfReading || '');
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
    if (r.status === 'incorrect_new' && r.isManuallyReviewed !== true) awaitingReview += 1;
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

/** Canonical semver key for matching (strip leading `v`, lowercase). */
function appVersionCanonicalKey(version: string): string {
  return version.trim().replace(/^v/i, '').toLowerCase();
}

/** App versions hidden from dashboard version charts (canonical key, no leading `v`). */
const DASHBOARD_EXCLUDED_APP_VERSION_KEYS = new Set(['4.9.55', '4.11.59']);

/** `v4.9.55`, `4.9.55`, etc. */
export function isAppVersionExcludedFromDashboardViz(appVersion: string): boolean {
  return DASHBOARD_EXCLUDED_APP_VERSION_KEYS.has(appVersionCanonicalKey(appVersion));
}

/** Earliest upload day (yyyy-mm-dd) in a group; empty string if none. */
function earliestUploadDay(readings: S3MeterReading[]): string {
  let min = '';
  for (const r of readings) {
    const d = calendarDayKeyInPortalTz(r.dateOfReading || '');
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

/** Median upload day (yyyy-mm-dd) — stable “when this version lived” vs one stray late first upload. */
function medianUploadDay(readings: S3MeterReading[]): string {
  const days = readings
    .map((r) => calendarDayKeyInPortalTz(r.dateOfReading || ''))
    .filter((d): d is string => Boolean(d))
    .sort();
  if (days.length === 0) return '';
  const mid = Math.floor(days.length / 2);
  return days.length % 2 === 1 ? days[mid]! : days[mid - 1]!;
}

/** Tie-break only (same calendar bucket): numeric segments from e.g. v4.11.59 — not used as primary time axis. */
function semanticVersionSortKey(version: string): number[] {
  if (version === 'unknown') return [];
  const s = version.trim().replace(/^v/i, '');
  const parts = s.split(/[.\-+]/);
  const nums: number[] = [];
  for (const p of parts) {
    const m = p.match(/^\d+/);
    if (m) nums.push(parseInt(m[0], 10));
    else break;
  }
  return nums.length ? nums : [0];
}

function compareSemanticVersionStrings(a: string, b: string): number {
  const ka = semanticVersionSortKey(a);
  const kb = semanticVersionSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const da = ka[i] ?? 0;
    const db = kb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

type VersionAggRow = {
  appVersion: string;
  list: S3MeterReading[];
  medianDay: string;
  firstDay: string;
};

function weekStartMondayIso(isoDay: string): string {
  if (!isoDay) return '';
  return mondayOfWeekContaining(isoDay);
}

/** When several builds land in the same ISO week, keep one row for the chart (not sorted by accuracy). */
function pickRepresentativeForWeek(bucket: VersionAggRow[]): VersionAggRow {
  const sorted = [...bucket].sort((a, b) => {
    if (b.list.length !== a.list.length) return b.list.length - a.list.length;
    const dayA = a.medianDay || a.firstDay;
    const dayB = b.medianDay || b.firstDay;
    if (dayB !== dayA) return dayB.localeCompare(dayA);
    return compareSemanticVersionStrings(b.appVersion, a.appVersion);
  });
  return sorted[0]!;
}

/**
 * At most **one app version per ISO week** (Monday start): if several builds share the same week (by median upload
 * day), we keep the one with the **most sessions**, then tie-break by later typical day / higher semver — never by
 * accuracy. Sessions without `app_version` are omitted.
 *
 * **X-axis order:** bins are sorted by **semantic version ascending** (e.g. v4.9 before v4.11), then capped to the
 * **highest** `maxVersions` builds (`slice(-maxV)` on that list).
 */
export function buildImprovementStoryBinsByAppVersion(
  readings: S3MeterReading[],
  options?: { maxVersions?: number },
): ImprovementStoryBin[] {
  const maxV = options?.maxVersions ?? 16;

  const groups = new Map<string, S3MeterReading[]>();
  for (const r of readings) {
    const v = normalizeReadingAppVersion(r);
    if (v === 'unknown') continue;
    if (isAppVersionExcludedFromDashboardViz(v)) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(r);
  }

  const rows: VersionAggRow[] = [...groups.entries()].map(([appVersion, list]) => ({
    appVersion,
    list,
    medianDay: medianUploadDay(list),
    firstDay: earliestUploadDay(list),
  }));

  const anchorDay = (row: VersionAggRow): string => row.medianDay || row.firstDay;

  const byWeek = new Map<string, VersionAggRow[]>();
  for (const row of rows) {
    const d = anchorDay(row);
    const wk = d ? weekStartMondayIso(d) : '__nodate__';
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(row);
  }

  const condensed: VersionAggRow[] = [];
  const datedWeekKeys = [...byWeek.keys()].filter((k) => k !== '__nodate__').sort((a, b) => a.localeCompare(b));

  for (const wk of datedWeekKeys) {
    condensed.push(pickRepresentativeForWeek(byWeek.get(wk)!));
  }

  if (byWeek.has('__nodate__')) {
    condensed.push(pickRepresentativeForWeek(byWeek.get('__nodate__')!));
  }

  condensed.sort((a, b) => {
    const da = anchorDay(a);
    const db = anchorDay(b);
    if (!da && db) return 1;
    if (da && !db) return -1;
    return compareSemanticVersionStrings(a.appVersion, b.appVersion);
  });

  const capped = condensed.length <= maxV ? condensed : condensed.slice(-maxV);

  return capped.map(({ appVersion, list }) =>
    improvementBinFromSessions(appVersion, appVersion, appVersion, list),
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
