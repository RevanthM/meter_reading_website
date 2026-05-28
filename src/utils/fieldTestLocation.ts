import type { CaptureLocation } from '../services/api';
import { captureLocationListLine, formatLatLon } from './captureLocation';

export const FIELD_TEST_UNKNOWN_CITY_KEY = '__unknown__';

export type FieldTestCityOption = {
  id: string;
  label: string;
  count: number;
};

/** Stable key for grouping captures by city (first segment of place label). */
export function fieldTestCityKeyFromReading(reading: {
  location?: string;
  captureLocation?: CaptureLocation | null;
}): string {
  const loc = reading.captureLocation;
  const place = String(loc?.placeLabel || '').trim();
  if (place) {
    const city = place.split(',')[0]?.trim();
    if (city) return normalizeCityKey(city);
  }
  const line = String(reading.location || '').trim();
  if (line && line !== 'Location unavailable') {
    const city = line.split(',')[0]?.trim();
    if (city) return normalizeCityKey(city);
  }
  if (loc?.coordinateLabel?.trim()) {
    return normalizeCityKey(loc.coordinateLabel.trim());
  }
  if (
    typeof loc?.latitude === 'number' &&
    typeof loc?.longitude === 'number' &&
    Number.isFinite(loc.latitude) &&
    Number.isFinite(loc.longitude)
  ) {
    return normalizeCityKey(formatLatLon(loc.latitude, loc.longitude));
  }
  return FIELD_TEST_UNKNOWN_CITY_KEY;
}

export function fieldTestCityLabelFromKey(key: string, fallbackLabel?: string): string {
  if (key === FIELD_TEST_UNKNOWN_CITY_KEY) return 'Unknown / no city';
  if (fallbackLabel?.trim()) return fallbackLabel.trim();
  return key
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function normalizeCityKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildFieldTestCityOptions(
  readings: Array<{ location?: string; captureLocation?: CaptureLocation | null }>,
): FieldTestCityOption[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const r of readings) {
    const key = fieldTestCityKeyFromReading(r);
    const label =
      key === FIELD_TEST_UNKNOWN_CITY_KEY
        ? fieldTestCityLabelFromKey(key)
        : fieldTestCityLabelFromKey(key, captureLocationListLine(r.captureLocation).split(',')[0]);
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { label, count: 1 });
  }
  return [...map.entries()]
    .map(([id, { label, count }]) => ({ id, label, count }))
    .sort((a, b) => {
      if (a.id === FIELD_TEST_UNKNOWN_CITY_KEY) return 1;
      if (b.id === FIELD_TEST_UNKNOWN_CITY_KEY) return -1;
      return a.label.localeCompare(b.label);
    });
}

export function matchesFieldTestCityFilter(
  reading: { location?: string; captureLocation?: CaptureLocation | null },
  locationFilter: string,
): boolean {
  const sel = String(locationFilter || '').trim();
  if (!sel || sel === 'all') return true;
  return fieldTestCityKeyFromReading(reading) === sel;
}
