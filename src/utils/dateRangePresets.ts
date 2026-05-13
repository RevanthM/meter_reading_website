/** Calendar quick ranges in Pacific time (YYYY-MM-DD inclusive). */

import { addPortalCalendarDays, calendarDayKeyInPortalTz } from './readingDisplayDates';

export type DateRangePresetId = 'today' | 'yesterday' | 'last7' | 'last30';

/** Pacific calendar yyyy-mm-dd for an instant. */
export function localYmd(d: Date): string {
  return calendarDayKeyInPortalTz(d.toISOString());
}

export function isDateRangePresetId(s: string): s is DateRangePresetId {
  return s === 'today' || s === 'yesterday' || s === 'last7' || s === 'last30';
}

/** Inclusive [from, to] using Pacific calendar days. */
export function getDateRangeFromPreset(preset: DateRangePresetId): { from: string; to: string } {
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

export function formatPresetLabel(preset: DateRangePresetId): string {
  switch (preset) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'last7':
      return 'Last 7 days';
    case 'last30':
      return 'Last 30 days';
    default:
      return preset;
  }
}
