/** Calendar quick ranges in Pacific time (YYYY-MM-DD inclusive). */
import { calendarDayKeyInPortalTz } from './improvementAnalytics.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function utcMillisForZonedPortalMidnight(ymd) {
  if (!ISO_DAY.test(ymd)) return null;
  const [Y, M, D] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) return null;
  const lo = Date.UTC(Y, M - 1, D - 1, 6, 0, 0);
  const hi = Date.UTC(Y, M - 1, D + 1, 15, 0, 0);
  for (let t = lo; t <= hi; t += 60 * 1000) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(t))
      .reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
    const year = +p.year;
    const month = +p.month;
    const day = +p.day;
    const hour = +p.hour;
    const minute = +p.minute;
    const second = +p.second;
    if (year === Y && month === M && day === D && hour === 0 && minute === 0 && second === 0) {
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

export function isDateRangePresetId(s) {
  return s === 'today' || s === 'yesterday' || s === 'last7' || s === 'last30';
}

/** Inclusive [from, to] using Pacific calendar days. */
export function getDateRangeFromPreset(preset) {
  const todayYmd = calendarDayKeyInPortalTz(new Date().toISOString());

  if (preset === 'today') return { from: todayYmd, to: todayYmd };

  if (preset === 'yesterday') {
    const ymd = addPortalCalendarDays(todayYmd, -1);
    return { from: ymd, to: ymd };
  }

  if (preset === 'last7') {
    return { from: addPortalCalendarDays(todayYmd, -6), to: todayYmd };
  }

  return { from: addPortalCalendarDays(todayYmd, -29), to: todayYmd };
}
