/** GPS snapshot from iOS `metadata.capture_location` (via API). */
export type CaptureLocation = {
  placeLabel?: string | null;
  coordinateLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  capturedAt?: string | null;
};

export function captureLocationListLine(loc: CaptureLocation | null | undefined): string {
  if (!loc) return 'Location unavailable';
  const place = loc.placeLabel?.trim();
  if (place) return place;
  const coord = loc.coordinateLabel?.trim();
  if (coord) return coord;
  if (
    typeof loc.latitude === 'number' &&
    typeof loc.longitude === 'number' &&
    Number.isFinite(loc.latitude) &&
    Number.isFinite(loc.longitude)
  ) {
    return formatLatLon(loc.latitude, loc.longitude);
  }
  return 'Location unavailable';
}

export function formatLatLon(lat: number, lon: number): string {
  const latH = lat >= 0 ? 'N' : 'S';
  const lonH = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latH}, ${Math.abs(lon).toFixed(5)}° ${lonH}`;
}

/** Decimal degrees for detail views (e.g. 33.88120, -117.96450). */
export function formatDecimalLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function captureLocationMapsUrl(loc: CaptureLocation): string | null {
  const lat = loc.latitude;
  const lon = loc.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return `https://maps.google.com/?q=${lat},${lon}`;
}

export function formatUploadModeLabel(mode: string | undefined): string {
  const m = (mode || '').trim().toLowerCase();
  if (m === 'simulator') return 'Simulator';
  if (m === 'field') return 'Field';
  return mode?.trim() || '—';
}
