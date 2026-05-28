/**
 * City grouping for field-test location filters (matches portal fieldTestLocation.ts).
 */

export const FIELD_TEST_UNKNOWN_CITY_KEY = '__unknown__';

function formatLatLon(lat, lon) {
  const latH = lat >= 0 ? 'N' : 'S';
  const lonH = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latH}, ${Math.abs(lon).toFixed(5)}° ${lonH}`;
}

function normalizeCityKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function fieldTestCityKeyFromReading(reading) {
  const loc = reading?.captureLocation;
  const place = String(loc?.placeLabel || '').trim();
  if (place) {
    const city = place.split(',')[0]?.trim();
    if (city) return normalizeCityKey(city);
  }
  const line = String(reading?.location || '').trim();
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

export function fieldTestCityLabelFromKey(key, fallbackLabel) {
  if (key === FIELD_TEST_UNKNOWN_CITY_KEY) return 'Unknown / no city';
  if (fallbackLabel?.trim()) return fallbackLabel.trim();
  return String(key)
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

export function buildFieldTestCityOptions(readings) {
  const map = new Map();
  for (const r of readings) {
    const key = fieldTestCityKeyFromReading(r);
    const place = String(r.captureLocation?.placeLabel || r.location || '').trim();
    const label =
      key === FIELD_TEST_UNKNOWN_CITY_KEY
        ? fieldTestCityLabelFromKey(key)
        : fieldTestCityLabelFromKey(key, place.split(',')[0]);
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { id: key, label, count: 1 });
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === FIELD_TEST_UNKNOWN_CITY_KEY) return 1;
    if (b.id === FIELD_TEST_UNKNOWN_CITY_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}

export function matchesFieldTestCityFilter(reading, locationFilter) {
  const sel = String(locationFilter || '').trim();
  if (!sel || sel === 'all') return true;
  return fieldTestCityKeyFromReading(reading) === sel;
}
