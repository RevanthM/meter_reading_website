import { calendarDayKeyInPortalTz } from './improvementAnalytics.js';
import { getDateRangeFromPreset, isDateRangePresetId } from './dateRangePresets.js';

export function matchesFieldTestDatePreset(reading, datePreset) {
  const preset = String(datePreset || 'all').trim().toLowerCase();
  if (!preset || preset === 'all') return true;
  if (!isDateRangePresetId(preset)) return true;

  const { from, to } = getDateRangeFromPreset(preset);
  const day = calendarDayKeyInPortalTz(
    reading?.dateOfReading || reading?.date || reading?.capturedAt || '',
  );
  if (!day) return false;
  return day >= from && day <= to;
}
