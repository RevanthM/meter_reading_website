/** Gyro snapshot at in-app camera shutter (`metadata.capture_device_tilt`). */
export type CaptureDeviceTilt = {
  rollDeg?: number | null;
  pitchDeg?: number | null;
  levelDotOffsetXNorm?: number | null;
  levelDotOffsetYNorm?: number | null;
  isLevel?: boolean | null;
  capturedAt?: string | null;
};

export function formatTiltDegrees(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`;
}

export function captureDeviceTiltLevelLabel(tilt: CaptureDeviceTilt | null | undefined): string {
  if (!tilt) return 'Not recorded';
  if (tilt.isLevel === true) return 'Level';
  if (tilt.isLevel === false) return 'Tilted';
  return '—';
}

export function captureDeviceTiltUnavailableReason(imageSource?: string | null): string {
  const src = (imageSource || '').trim().toLowerCase();
  if (src === 'gallery' || src === 'photo_library' || src === 'library') {
    return 'Gallery picks do not record phone tilt at shutter time.';
  }
  return 'Recorded only for in-app camera captures with gyro data.';
}
