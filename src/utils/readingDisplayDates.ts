const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** All reading dates and calendar chips use Pacific (handles PDT / PST). */
export const PORTAL_DISPLAY_TIME_ZONE = 'America/Los_Angeles';

function parseReadingInstant(dateString: string): Date | null {
  const s = (dateString || '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  const day = s.split('T')[0] ?? '';
  if (ISO_DAY.test(day)) return new Date(`${day}T12:00:00Z`);
  return null;
}

function zonedCalendarParts(d: Date, timeZone: string) {
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
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return {
    year: +(get('year') || 0),
    month: +(get('month') || 0),
    day: +(get('day') || 0),
    hour: +(get('hour') || 0),
    minute: +(get('minute') || 0),
    second: +(get('second') || 0),
  };
}

/** Calendar yyyy-mm-dd in the portal timezone (Pacific). */
export function calendarDayKeyInPortalTz(dateString: string): string {
  const d = parseReadingInstant(dateString);
  if (!d) return '';
  const p = zonedCalendarParts(d, PORTAL_DISPLAY_TIME_ZONE);
  if (!p.year) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Short date for tables and detail: `MM/DD/YY` in Pacific. */
export function formatReadingShortDate(dateString: string): string {
  const d = parseReadingInstant(dateString);
  if (!d) return '—';
  const p = zonedCalendarParts(d, PORTAL_DISPLAY_TIME_ZONE);
  if (!p.year) return '—';
  return `${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')}/${String(p.year % 100).padStart(2, '0')}`;
}

/** Human label for “today” in Pacific (e.g. Tue, Jan 24, 2026). */
export function formatPortalWeekdayMedium(isoInstant: string): string {
  const d = parseReadingInstant(isoInstant);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * UTC instant of 00:00:00 on `ymd` in Pacific (best-effort; rare DST gaps fall back to noon UTC that calendar day).
 */
export function utcMillisForZonedPortalMidnight(ymd: string): number | null {
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

/** Add signed calendar days in Pacific (midnight-to-midnight approximation). */
export function addPortalCalendarDays(ymd: string, delta: number): string {
  const ms = utcMillisForZonedPortalMidnight(ymd);
  if (ms == null || !Number.isFinite(delta)) return ymd;
  return calendarDayKeyInPortalTz(new Date(ms + delta * 24 * 60 * 60 * 1000).toISOString());
}

/** Oldest → newest: `n` consecutive Pacific calendar days ending on `anchor`’s Pacific day. */
export function portalDayKeysRollingWindow(n: number, anchor: Date = new Date()): string[] {
  const todayYmd = calendarDayKeyInPortalTz(anchor.toISOString());
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(addPortalCalendarDays(todayYmd, -i));
  }
  return keys;
}
