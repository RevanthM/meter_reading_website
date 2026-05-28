import type { FieldTestCaptureRow, FieldTestCycle, ImageDifficulty, S3MeterReading } from '../services/api';
import { calendarDayKeyInPortalTz } from './readingDisplayDates';

/** Portal reading row → field test image grid row (no presigned URLs). */
export function fieldTestCaptureFromReading(r: S3MeterReading): FieldTestCaptureRow {
  const extended = r as S3MeterReading & {
    primaryImageKey?: string;
    onTickDialCount?: number | null;
    readsCorrectedCount?: number;
  };
  const difficulty = String(r.imageDifficulty || 'normal').toLowerCase() as ImageDifficulty;
  const finalReading =
    String(r.expectedValue || r.meterValue || '')
      .replace(/\D/g, '')
      .padStart(4, '0')
      .slice(-4) || null;
  return {
    sessionId: r.id,
    s3SessionPrefix: r.s3SessionPrefix,
    s3Bucket: r.bucket,
    primaryImageKey: extended.primaryImageKey,
    capturedAt: r.dateOfReading || r.createdAt || '',
    capturedBy: r.userName || '',
    finalReading,
    predictedReading: r.meterValue || null,
    imageDifficulty: difficulty,
    onTickDialCount: extended.onTickDialCount ?? null,
    readsCorrectedCount: extended.readsCorrectedCount ?? 0,
    hadUserCorrection: r.hadUserCorrection === true,
    dialCount: r.dialCount ?? 4,
    confidence: r.confidence ?? null,
    appVersion: r.appVersion || null,
    captureTrigger: r.captureTrigger || null,
    imageSource: r.imageSource || null,
  };
}

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
