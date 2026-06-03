import type { CaptureLocation } from '../services/api';
import type { S3MeterReading } from '../services/api';

/** Default map anchor — central California (state-level zoom in CaptureMapView). */
export const CALIFORNIA_MAP_CENTER: [number, number] = [37.0, -120.0];
export const CALIFORNIA_MAP_ZOOM = 6;

export type CaptureMapPoint = {
  reading: S3MeterReading;
  lat: number;
  lng: number;
};

export type CaptureMapCluster = {
  id: string;
  lat: number;
  lng: number;
  readings: S3MeterReading[];
};

export function captureCoords(loc: CaptureLocation | null | undefined): { lat: number; lng: number } | null {
  const lat = loc?.latitude;
  const lng = loc?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

export function splitReadingsByLocation(readings: S3MeterReading[]): {
  located: CaptureMapPoint[];
  unlocated: S3MeterReading[];
} {
  const located: CaptureMapPoint[] = [];
  const unlocated: S3MeterReading[] = [];
  for (const reading of readings) {
    const coords = captureCoords(reading.captureLocation);
    if (coords) {
      located.push({ reading, ...coords });
    } else {
      unlocated.push(reading);
    }
  }
  return { located, unlocated };
}

/** Bucket nearby captures (~100 m at precision 3). */
export function clusterCapturePoints(points: CaptureMapPoint[], precision = 3): CaptureMapCluster[] {
  const map = new Map<string, CaptureMapCluster>();
  for (const p of points) {
    const key = `${p.lat.toFixed(precision)},${p.lng.toFixed(precision)}`;
    const existing = map.get(key);
    if (existing) {
      existing.readings.push(p.reading);
    } else {
      map.set(key, {
        id: key,
        lat: p.lat,
        lng: p.lng,
        readings: [p.reading],
      });
    }
  }
  return [...map.values()];
}
