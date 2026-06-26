/** Calendar quick ranges in Pacific time (YYYY-MM-DD inclusive). */

import { addPortalCalendarDays, calendarDayKeyInPortalTz } from './readingDisplayDates';

export type DateRangePresetId = 'today' | 'yesterday' | 'last7' | 'last30';

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

/** Normalize custom URL `from`/`to` params to an inclusive Pacific day window. */
export function normalizeDateRangeWindow(
  from: string,
  to: string,
): { from: string; to: string } | null {
  const lo = from.trim();
  const hi = to.trim();
  if (!ISO_DAY.test(lo) || !ISO_DAY.test(hi)) return null;
  return lo <= hi ? { from: lo, to: hi } : { from: hi, to: lo };
}

/** Resolve partial from/to (From-only → through today in Pacific). */
export function resolveCustomDateRangeWindow(
  from: string,
  to: string,
  todayYmd: string = calendarDayKeyInPortalTz(new Date().toISOString()),
): { from: string; to: string } | null {
  const lo = from.trim();
  const hi = to.trim();
  const hasFrom = ISO_DAY.test(lo);
  const hasTo = ISO_DAY.test(hi);
  if (!hasFrom && !hasTo) return null;
  if (hasFrom && hasTo) return normalizeDateRangeWindow(lo, hi);
  if (hasFrom) return { from: lo, to: todayYmd };
  return { from: '2000-01-01', to: hi };
}

export function formatCustomDateRangeLabel(window: { from: string; to: string }): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  if (window.from === window.to) return fmt(window.from);
  return `${fmt(window.from)} – ${fmt(window.to)}`;
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
