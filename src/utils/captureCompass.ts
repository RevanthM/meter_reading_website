/** Compass snapshot at in-app camera shutter (`metadata.capture_compass`). */
export type CaptureCompass = {
  cameraHeadingDeg?: number | null;
  cameraFacing?: string | null;
  meterFacingDeg?: number | null;
  meterFacing?: string | null;
  headingAccuracyDeg?: number | null;
  capturedAt?: string | null;
};

export function formatHeadingDegrees(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}°`;
}

export function meterFacingPrimaryLabel(compass: CaptureCompass | null | undefined): string {
  if (!compass) return 'Not recorded';
  const label = compass.meterFacing?.trim();
  const deg = formatHeadingDegrees(compass.meterFacingDeg);
  if (label && deg !== '—') return `Meter faces ${label} (${deg})`;
  if (label) return `Meter faces ${label}`;
  if (deg !== '—') return `Meter faces ${deg}`;
  return 'Not recorded';
}

export function cameraFacingSubLabel(compass: CaptureCompass | null | undefined): string {
  if (!compass) return '';
  const parts: string[] = [];
  const camera = compass.cameraFacing?.trim();
  if (camera) parts.push(`Camera ${camera}`);
  if (compass.headingAccuracyDeg != null && Number.isFinite(compass.headingAccuracyDeg)) {
    parts.push(`±${Math.round(compass.headingAccuracyDeg)}° accuracy`);
  }
  return parts.join(' · ');
}

export function captureCompassUnavailableReason(imageSource?: string | null): string {
  const src = (imageSource || '').trim().toLowerCase();
  if (src === 'gallery' || src === 'photo_library' || src === 'library') {
    return 'Gallery picks do not record compass heading at shutter time.';
  }
  if (src === 'camera') {
    return 'In-app camera was used, but the phone had no compass heading at shutter (wait a moment after opening the camera, stay away from metal, and ensure Location is allowed).';
  }
  return 'Compass heading was not stored for this session.';
}
