import { calendarDayKeyInPortalTz } from './improvementAnalytics.js';

/** Pacific portal calendar day (yyyy-mm-dd) for a capture timestamp. */
export function fieldTestCaptureDayKey(ts) {
  const s = String(ts || '').trim();
  if (!s) return '';
  return calendarDayKeyInPortalTz(s);
}
