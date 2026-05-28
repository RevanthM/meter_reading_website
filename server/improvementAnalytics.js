/**
 * Pre-aggregated "Are we improving?" chart data in a dedicated analytics bucket.
 * Maintains a per-scope session index; manifest bins are derived on read (and after writes).
 */

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const PORTAL_DISPLAY_TIME_ZONE = 'America/Los_Angeles';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const TRAINING_FUNNEL_STATUSES = new Set([
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
]);

const DASHBOARD_EXCLUDED_APP_VERSION_KEYS = new Set(['4.9.55', '4.11.59']);

const CHART_RANGE_DAY_COUNT = {
  '1d': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

/** @typedef {'all' | '1d' | '7d' | '14d' | '30d'} ChartRangeId */

/**
 * @typedef {Object} SessionContrib
 * @property {string} sessionId
 * @property {string} appVersion
 * @property {string} status
 * @property {string} portalDay
 * @property {number} imageCount
 * @property {number} [confNorm]
 * @property {number} [modelVsCorrectionPct]
 */

/**
 * @typedef {Object} ImprovementStoryBin
 * @property {string} date
 * @property {string} drillIso
 * @property {string} [barLabel]
 * @property {number} totalSessions
 * @property {number} totalImages
 * @property {number | null} avgConfidencePct
 * @property {number} confidenceSessions
 * @property {number | null} modelVsCorrectionPct
 * @property {number} modelVsCorrectionSessions
 * @property {number} awaitingReview
 * @property {number} inTrainingFunnel
 */

function parseReadingInstant(dateString) {
  const s = (dateString || '').trim();
  if (!s) return null;
  if (ISO_DAY.test(s)) return new Date(`${s}T12:00:00Z`);
  const normalized =
    /^\d{4}-\d{2}-\d{2}T/.test(s) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) ? `${s}Z` : s;
  const t = Date.parse(normalized);
  if (!Number.isNaN(t)) return new Date(t);
  const day = s.split('T')[0] ?? '';
  if (ISO_DAY.test(day)) return new Date(`${day}T12:00:00Z`);
  return null;
}

function zonedCalendarParts(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: +(get('year') || 0),
    month: +(get('month') || 0),
    day: +(get('day') || 0),
    hour: +(get('hour') || 0),
    minute: +(get('minute') || 0),
    second: +(get('second') || 0),
  };
}

export function calendarDayKeyInPortalTz(dateString) {
  const d = parseReadingInstant(dateString);
  if (!d) return '';
  const p = zonedCalendarParts(d, PORTAL_DISPLAY_TIME_ZONE);
  if (!p.year) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function utcMillisForZonedPortalMidnight(ymd) {
  if (!ISO_DAY.test(ymd)) return null;
  const [Y, M, D] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) return null;
  const lo = Date.UTC(Y, M - 1, D - 1, 6, 0, 0);
  const hi = Date.UTC(Y, M - 1, D + 1, 15, 0, 0);
  for (let t = lo; t <= hi; t += 60 * 1000) {
    const p = zonedCalendarParts(new Date(t), PORTAL_DISPLAY_TIME_ZONE);
    if (p.year === Y && p.month === M && p.day === D && p.hour === 0 && p.minute === 0 && p.second === 0) {
      return t;
    }
  }
  return Date.parse(`${ymd}T12:00:00Z`);
}

function addPortalCalendarDays(ymd, delta) {
  const ms = utcMillisForZonedPortalMidnight(ymd);
  if (ms == null || !Number.isFinite(delta)) return ymd;
  return calendarDayKeyInPortalTz(new Date(ms + delta * 24 * 60 * 60 * 1000).toISOString());
}

function portalDayKeysRollingWindow(n, anchor = new Date()) {
  const todayYmd = calendarDayKeyInPortalTz(anchor.toISOString());
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(addPortalCalendarDays(todayYmd, -i));
  }
  return keys;
}

function mondayOfWeekContaining(portalYmd) {
  if (!portalYmd || !ISO_DAY.test(portalYmd)) return '';
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

function appVersionCanonicalKey(version) {
  return version.trim().replace(/^v/i, '').toLowerCase();
}

function normalizeReadingAppVersion(raw) {
  return raw != null && String(raw).trim() !== '' ? String(raw).trim() : 'unknown';
}

function isAppVersionExcludedFromDashboardViz(appVersion) {
  return DASHBOARD_EXCLUDED_APP_VERSION_KEYS.has(appVersionCanonicalKey(appVersion));
}

function normalizeConfidenceScalar(raw) {
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

function sessionModelVsCorrectionPct(meterValue, expectedValue) {
  const exp = String(expectedValue ?? '').replace(/\D/g, '');
  const pred = String(meterValue ?? '').replace(/\D/g, '');
  if (!exp || !pred) return null;
  const len = Math.min(4, exp.length, pred.length);
  if (len === 0) return null;
  let match = 0;
  for (let i = 0; i < len; i++) {
    if (exp[i] === pred[i]) match += 1;
  }
  return (match / len) * 100;
}

function readingConfidenceNorm(reading) {
  const top = normalizeConfidenceScalar(reading.confidence);
  if (top !== undefined) return top;
  const dials = reading.dialDetails;
  if (Array.isArray(dials) && dials.length > 0) {
    const nested = dials
      .map((d) => (d && typeof d === 'object' ? normalizeConfidenceScalar(d.confidence) : undefined))
      .filter((n) => n !== undefined);
    if (nested.length > 0) return Math.min(...nested);
  }
  return undefined;
}

export function sessionContribFromReading(reading) {
  const appVersion = normalizeReadingAppVersion(reading.appVersion);
  if (appVersion === 'unknown' || isAppVersionExcludedFromDashboardViz(appVersion)) {
    return null;
  }
  const confNorm = readingConfidenceNorm(reading);
  const modelPct = sessionModelVsCorrectionPct(reading.meterValue, reading.expectedValue);
  const imageCount =
    typeof reading.imageCount === 'number' && Number.isFinite(reading.imageCount)
      ? reading.imageCount
      : Array.isArray(reading.images)
        ? reading.images.length
        : 0;

  return {
    sessionId: String(reading.id),
    appVersion,
    status: String(reading.status || ''),
    portalDay: calendarDayKeyInPortalTz(reading.dateOfReading || ''),
    imageCount,
    ...(confNorm !== undefined ? { confNorm } : {}),
    ...(modelPct != null ? { modelVsCorrectionPct: modelPct } : {}),
  };
}

function semanticVersionSortKey(version) {
  if (version === 'unknown') return [];
  const s = version.trim().replace(/^v/i, '');
  const parts = s.split(/[.\-+]/);
  const nums = [];
  for (const p of parts) {
    const m = p.match(/^\d+/);
    if (m) nums.push(parseInt(m[0], 10));
    else break;
  }
  return nums.length ? nums : [0];
}

function compareSemanticVersionStrings(a, b) {
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

function medianUploadDay(contribs) {
  const days = contribs
    .map((c) => c.portalDay)
    .filter(Boolean)
    .sort();
  if (days.length === 0) return '';
  const mid = Math.floor(days.length / 2);
  return days.length % 2 === 1 ? days[mid] : days[mid - 1];
}

function earliestUploadDay(contribs) {
  let min = '';
  for (const c of contribs) {
    const d = c.portalDay;
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

function pickRepresentativeForWeek(bucket) {
  const sorted = [...bucket].sort((a, b) => {
    if (b.list.length !== a.list.length) return b.list.length - a.list.length;
    const dayA = a.medianDay || a.firstDay;
    const dayB = b.medianDay || b.firstDay;
    if (dayB !== dayA) return dayB.localeCompare(dayA);
    return compareSemanticVersionStrings(b.appVersion, a.appVersion);
  });
  return sorted[0];
}

function improvementBinFromSessions(id, drillKey, barLabel, list) {
  let totalImages = 0;
  let sumConf = 0;
  let confN = 0;
  let modelSum = 0;
  let modelN = 0;
  let awaitingReview = 0;
  let inTrainingFunnel = 0;

  for (const c of list) {
    totalImages += c.imageCount || 0;
    if (c.confNorm !== undefined) {
      sumConf += c.confNorm;
      confN += 1;
    }
    if (c.modelVsCorrectionPct != null) {
      modelSum += c.modelVsCorrectionPct;
      modelN += 1;
    }
    if (c.status === 'incorrect_new') awaitingReview += 1;
    if (TRAINING_FUNNEL_STATUSES.has(c.status)) inTrainingFunnel += 1;
  }

  const avgConfidencePct = confN > 0 ? (sumConf / confN) * 100 : null;
  const modelVsCorrectionPct = modelN > 0 ? modelSum / modelN : null;

  return {
    date: id,
    drillIso: drillKey,
    barLabel,
    totalSessions: list.length,
    totalImages,
    avgConfidencePct,
    confidenceSessions: confN,
    modelVsCorrectionPct,
    modelVsCorrectionSessions: modelN,
    awaitingReview,
    inTrainingFunnel,
  };
}

/**
 * @param {SessionContrib[]} contribs
 * @param {{ maxVersions?: number }} [options]
 * @returns {ImprovementStoryBin[]}
 */
/** Per app_version rollups for dashboard model bars (from analytics index, no full readings scan). */
export function buildVersionSummaryFromContribs(contribs) {
  const byVersion = new Map();

  for (const c of contribs) {
    const v = c.appVersion;
    if (!v || v === 'unknown' || isAppVersionExcludedFromDashboardViz(v)) continue;
    if (!byVersion.has(v)) {
      byVersion.set(v, {
        appVersion: v,
        sessions: 0,
        imageCount: 0,
        correctCount: 0,
        incorrectTotal: 0,
        notSureCount: 0,
        noDialsCount: 0,
        sumConf: 0,
        confN: 0,
        statusCounts: {},
      });
    }
    const g = byVersion.get(v);
    g.sessions += 1;
    g.imageCount += c.imageCount || 0;
    const st = c.status || 'unknown';
    g.statusCounts[st] = (g.statusCounts[st] || 0) + 1;
    if (st === 'correct') g.correctCount += 1;
    else if (st === 'not_sure') g.notSureCount += 1;
    else if (st === 'no_dials') g.noDialsCount += 1;
    else if (
      st === 'incorrect_new' ||
      st === 'incorrect_analyzed' ||
      st === 'incorrect_labeled' ||
      st === 'incorrect_training'
    ) {
      g.incorrectTotal += 1;
    }
    if (c.confNorm !== undefined) {
      g.sumConf += c.confNorm;
      g.confN += 1;
    }
  }

  const rows = [...byVersion.values()].map((g) => {
    const sessions = g.sessions;
    const queueCorrectRate = sessions > 0 ? g.correctCount / sessions : 0;
    const incorrectTotal = g.incorrectTotal;
    return {
      appVersion: g.appVersion,
      sessions,
      imageCount: g.imageCount,
      statusCounts: g.statusCounts,
      correctCount: g.correctCount,
      incorrectTotal,
      notSureCount: g.notSureCount,
      noDialsCount: g.noDialsCount,
      queueCorrectRate,
      queueIncorrectRate: sessions > 0 ? incorrectTotal / sessions : 0,
      notSureRate: sessions > 0 ? g.notSureCount / sessions : 0,
      noDialsRate: sessions > 0 ? g.noDialsCount / sessions : 0,
      avgConfidence: g.confN > 0 ? g.sumConf / g.confN : null,
      avgProcessingTimeMs: null,
      avgDialCount: null,
      fieldCount: 0,
      simulatorCount: 0,
      firstSessionAt: null,
      lastSessionAt: null,
    };
  });

  rows.sort((a, b) => b.sessions - a.sessions);
  return rows;
}

export function buildImprovementBinsFromContribs(contribs, options = {}) {
  const maxV = options.maxVersions ?? 16;
  const groups = new Map();
  for (const c of contribs) {
    const v = c.appVersion;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }

  const rows = [...groups.entries()].map(([appVersion, list]) => ({
    appVersion,
    list,
    medianDay: medianUploadDay(list),
    firstDay: earliestUploadDay(list),
  }));

  const anchorDay = (row) => row.medianDay || row.firstDay;
  const byWeek = new Map();
  for (const row of rows) {
    const d = anchorDay(row);
    const wk = d ? mondayOfWeekContaining(d) : '__nodate__';
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(row);
  }

  const condensed = [];
  const datedWeekKeys = [...byWeek.keys()].filter((k) => k !== '__nodate__').sort((a, b) => a.localeCompare(b));
  for (const wk of datedWeekKeys) {
    condensed.push(pickRepresentativeForWeek(byWeek.get(wk)));
  }
  if (byWeek.has('__nodate__')) {
    condensed.push(pickRepresentativeForWeek(byWeek.get('__nodate__')));
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

function filterContribsByRange(contribs, rangeId) {
  if (rangeId === 'all') return contribs;
  const n = CHART_RANGE_DAY_COUNT[rangeId];
  if (!n) return contribs;
  const daySet = new Set(portalDayKeysRollingWindow(n));
  return contribs.filter((c) => c.portalDay && daySet.has(c.portalDay));
}

/**
 * @param {{ s3Client: import('@aws-sdk/client-s3').S3Client, bucketName: string, keyPrefix?: string, fallbackBucketName?: string, fallbackKeyPrefix?: string, region?: string, allowCreateBucket?: boolean, streamToString: (stream: unknown) => Promise<string> }} deps
 */
export function createImprovementAnalyticsStore({
  s3Client,
  bucketName,
  keyPrefix = '',
  fallbackBucketName,
  fallbackKeyPrefix = 'analytics',
  region = 'us-east-1',
  allowCreateBucket = false,
  streamToString,
}) {
  const prefix = String(keyPrefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const keyRoot = prefix ? `${prefix}/` : '';
  const scopeLocks = new Map();
  const indexMemCache = new Map();
  const statsMemCache = new Map();
  const IMPROVEMENT_CACHE_FRESH_MS = Math.max(
    0,
    parseInt(process.env.IMPROVEMENT_STATS_CACHE_FRESH_MS || process.env.API_CACHE_FRESH_MS || '8000', 10) || 0,
  );
  const INDEX_MEM_TTL_MS = IMPROVEMENT_CACHE_FRESH_MS;
  const STATS_MEM_TTL_MS = IMPROVEMENT_CACHE_FRESH_MS;
  let backfillInFlight = null;

  function scopeKey(source, workType) {
    return `${source || 'all'}:${workType || '1000'}`;
  }

  function indexKey(source, workType, prefixOverride) {
    const p = prefixOverride === undefined ? keyPrefix : prefixOverride;
    const root = p ? `${String(p).replace(/^\/+|\/+$/g, '')}/` : '';
    return `${root}improvement/${source || 'all'}/${workType || '1000'}/index.json`;
  }

  function indexReadCandidates(source, workType) {
    const primary = indexKey(source, workType);
    const seen = new Set([primary]);
    const candidates = [{ bucket: bucketName, key: primary }];

    const bare = indexKey(source, workType, '');
    if (!seen.has(bare)) {
      seen.add(bare);
      candidates.push({ bucket: bucketName, key: bare });
    }

    const analyticsInPrimaryBucket = indexKey(source, workType, 'analytics');
    if (!seen.has(analyticsInPrimaryBucket)) {
      seen.add(analyticsInPrimaryBucket);
      candidates.push({ bucket: bucketName, key: analyticsInPrimaryBucket });
    }

    const fbBucket = (fallbackBucketName || '').trim();
    if (fbBucket && fbBucket !== bucketName) {
      const fbPrefix = String(fallbackKeyPrefix || 'analytics')
        .trim()
        .replace(/^\/+|\/+$/g, '');
      const fbKey = indexKey(source, workType, fbPrefix);
      if (!seen.has(`${fbBucket}:${fbKey}`)) {
        candidates.push({ bucket: fbBucket, key: fbKey });
      }
    }

    return candidates;
  }

  async function withScopeLock(source, workType, fn) {
    const key = scopeKey(source, workType);
    const prev = scopeLocks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    scopeLocks.set(key, next.finally(() => {
      if (scopeLocks.get(key) === next) scopeLocks.delete(key);
    }));
    return next;
  }

  function cacheIndex(scope, indexDoc) {
    indexMemCache.set(scope, { data: indexDoc, at: Date.now() });
    for (const key of statsMemCache.keys()) {
      if (key.startsWith(`${scope}:`)) statsMemCache.delete(key);
    }
  }

  async function readIndex(source, workType) {
    const scope = scopeKey(source, workType);
    if (INDEX_MEM_TTL_MS > 0) {
      const hit = indexMemCache.get(scope);
      if (hit && Date.now() - hit.at < INDEX_MEM_TTL_MS) {
        return hit.data;
      }
    }

    const candidates = indexReadCandidates(source, workType);
    let lastErr = null;

    for (const { bucket, key } of candidates) {
      try {
        const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await streamToString(out.Body);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
          if (bucket !== bucketName || key !== indexKey(source, workType)) {
            console.log(
              `📈 Improvement index loaded from s3://${bucket}/${key} (canonical: s3://${bucketName}/${indexKey(source, workType)})`,
            );
          }
          cacheIndex(scope, parsed);
          return parsed;
        }
      } catch (err) {
        const missing =
          err?.name === 'NoSuchKey' ||
          err?.name === 'NotFound' ||
          err?.$metadata?.httpStatusCode === 404;
        if (!missing) {
          lastErr = err;
          console.warn(`improvement analytics: read s3://${bucket}/${key}:`, err.message);
        }
      }
    }

    if (lastErr?.name === 'AccessDenied' || lastErr?.$metadata?.httpStatusCode === 403) {
      console.warn(
        `improvement analytics: Access Denied for all index paths. Expected s3://${bucketName}/${indexKey(source, workType)} — grant s3:GetObject on analytics/* or unset AWS_ANALYTICS_S3_BUCKET.`,
      );
    }

    const empty = { version: 1, sessions: {}, updatedAt: null };
    cacheIndex(scope, empty);
    return empty;
  }

  async function writeIndex(source, workType, indexDoc) {
    const key = indexKey(source, workType);
    indexDoc.updatedAt = new Date().toISOString();
    cacheIndex(scopeKey(source, workType), indexDoc);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(indexDoc),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }

  async function upsertSession(source, workType, contrib) {
    if (!contrib?.sessionId) return;
    await withScopeLock(source, workType, async () => {
      const indexDoc = await readIndex(source, workType);
      indexDoc.sessions[contrib.sessionId] = contrib;
      await writeIndex(source, workType, indexDoc);
    });
  }

  async function removeSession(source, workType, sessionId) {
    if (!sessionId) return;
    await withScopeLock(source, workType, async () => {
      const indexDoc = await readIndex(source, workType);
      if (indexDoc.sessions[sessionId]) {
        delete indexDoc.sessions[sessionId];
        await writeIndex(source, workType, indexDoc);
      }
    });
  }

  /**
   * @param {(source: string, workType: string) => Promise<unknown[]>} fetchAllLightReadings
   */
  function isBackfillRunning() {
    return backfillInFlight != null;
  }

  async function backfill(source, workType, fetchAllLightReadings) {
    return withScopeLock(source, workType, async () => {
      console.log(`\n📈 Improvement analytics backfill (${source}, ${workType})…`);
      const readings = await fetchAllLightReadings(source, workType);
      const sessions = {};
      let parsed = 0;
      let i = 0;

      for (const reading of readings) {
        if (!reading) continue;
        const contrib = sessionContribFromReading(reading);
        if (contrib) {
          sessions[contrib.sessionId] = contrib;
          parsed += 1;
        }
        i += 1;
        if (i % 80 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      await writeIndex(source, workType, { version: 1, sessions });
      console.log(`📈 Improvement index: ${parsed} sessions indexed\n`);
      return { sessionCount: parsed };
    });
  }

  /**
   * @param {{ range?: ChartRangeId, maxVersions?: number, refresh?: boolean, fetchAllLightReadings?: (source: string, workType: string) => Promise<unknown[]> }} opts
   */
  function scheduleBackfill(source, workType, fetchAllLightReadings) {
    if (!fetchAllLightReadings || backfillInFlight) return;
    backfillInFlight = backfill(source, workType, fetchAllLightReadings)
      .catch((err) => console.warn('📈 improvement backfill (background):', err.message))
      .finally(() => {
        backfillInFlight = null;
      });
  }

  /** Sessions whose capture day (portal TZ) matches `dayYmd` (default: today). */
  async function countSessionsOnPortalDay(source, workType, dayYmd) {
    const indexDoc = await readIndex(source, workType);
    const target = dayYmd || calendarDayKeyInPortalTz(new Date().toISOString());
    let n = 0;
    for (const c of Object.values(indexDoc.sessions || {})) {
      if (c?.portalDay === target) n++;
    }
    return n;
  }

  async function getStats(source, workType, opts = {}) {
    const range = opts.range && opts.range !== '' ? opts.range : 'all';
    const maxVersions = opts.maxVersions ?? 16;
    const statsCacheKey = `${scopeKey(source, workType)}:${range}:${maxVersions}`;

    if (!opts.refresh && STATS_MEM_TTL_MS > 0) {
      const hit = statsMemCache.get(statsCacheKey);
      if (hit && Date.now() - hit.at < STATS_MEM_TTL_MS) {
        return hit.data;
      }
    }

    let indexDoc = await readIndex(source, workType);
    const sessionCount = Object.keys(indexDoc.sessions || {}).length;

    if (opts.fetchAllLightReadings) {
      if (opts.refresh) {
        scheduleBackfill(source, workType, opts.fetchAllLightReadings);
        indexDoc = await readIndex(source, workType);
      } else if (sessionCount === 0) {
        scheduleBackfill(source, workType, opts.fetchAllLightReadings);
        return {
          bins: [],
          versionSummary: [],
          windowSessionCount: 0,
          totalIndexedSessions: 0,
          computedAt: new Date().toISOString(),
          range,
          building: true,
          rebuilding: false,
        };
      }
    }

    const allContribs = Object.values(indexDoc.sessions || {});
    const filtered = filterContribsByRange(allContribs, range);
    const bins = buildImprovementBinsFromContribs(filtered, { maxVersions });
    const rebuilding = isBackfillRunning();

    const payload = {
      bins,
      versionSummary: buildVersionSummaryFromContribs(filtered),
      windowSessionCount: filtered.length,
      totalIndexedSessions: allContribs.length,
      computedAt: indexDoc.updatedAt || new Date().toISOString(),
      range,
      ...(rebuilding ? { rebuilding: true } : {}),
    };
    statsMemCache.set(statsCacheKey, { data: payload, at: Date.now() });
    return payload;
  }

  async function ensureBucketExists() {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch (err) {
      const missing =
        err.name === 'NotFound' ||
        err.name === 'NoSuchBucket' ||
        err.$metadata?.httpStatusCode === 404;
      if (!missing || !allowCreateBucket) {
        if (!missing) {
          console.warn(`⚠️  Analytics bucket "${bucketName}" check failed:`, err.message);
        }
        return false;
      }
    }

    if (!allowCreateBucket) return false;

    try {
      const params = { Bucket: bucketName };
      if (region && region !== 'us-east-1') {
        params.CreateBucketConfiguration = { LocationConstraint: region };
      }
      await s3Client.send(new CreateBucketCommand(params));
      console.log(`📈 Created analytics bucket: ${bucketName} (${region})`);
      return true;
    } catch (err) {
      if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
        return true;
      }
      console.warn(`⚠️  Could not create analytics bucket "${bucketName}":`, err.message);
      return false;
    }
  }

  function storageLocation(source, workType) {
    return {
      bucket: bucketName,
      key: indexKey(source, workType),
      uri: `s3://${bucketName}/${indexKey(source, workType)}`,
    };
  }

  return {
    bucketName,
    storageLocation,
    ensureBucketExists,
    upsertSession,
    removeSession,
    upsertFromReading(source, workType, reading) {
      const contrib = sessionContribFromReading(reading);
      if (!contrib) return Promise.resolve();
      return upsertSession(source, workType, contrib);
    },
    getStats,
    countSessionsOnPortalDay,
    backfill,
    readIndex,
  };
}
