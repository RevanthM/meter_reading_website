import type { FieldTestCycle, S3MeterReading } from '../services/api';
import { calendarDayKeyInPortalTz } from './readingDisplayDates';

/** Same rules as server `isFieldTestReading` in fieldTestRoutes.js */
export function isFieldTestReading(r: S3MeterReading): boolean {
  if (r.fieldTestCapture === true) return true;
  return (
    String(r.uploadMode || '').trim().toLowerCase() === 'field' &&
    String(r.type || 'field').toLowerCase() === 'field'
  );
}

/** Pacific calendar-day window for a field test cycle (client-side). */
export function filterFieldTestReadingsForCycle(
  readings: S3MeterReading[],
  cycle: FieldTestCycle | null | undefined,
): S3MeterReading[] {
  if (!cycle) return readings;
  return readings.filter((r) => {
    const day = calendarDayKeyInPortalTz(r.dateOfReading || '');
    if (!day) return false;
    return day >= cycle.startDate && day <= cycle.endDate;
  });
}

/** Matches ReadingsList date chips — Pacific yyyy-mm-dd in [from, to]. */
export function readingMatchesDateRangeWindow(
  reading: { dateOfReading?: string },
  window: { from: string; to: string } | null | undefined,
): boolean {
  if (!window) return true;
  const day = calendarDayKeyInPortalTz(reading.dateOfReading || '');
  return Boolean(day && day >= window.from && day <= window.to);
}
