import type { FieldTestCaptureRow, FieldTestCycle, ImageDifficulty, S3MeterReading } from '../services/api';
import { fieldTestCaptureFromReading as fieldTestDisplayFromReading } from './fieldTestDisplay';
import { fieldTestReviewerCorrectionMeta } from './fieldTestCorrectionMeta';
import { calendarDayKeyInPortalTz } from './readingDisplayDates';

/** Portal reading row → field test image grid row (no presigned URLs). */
export function fieldTestCaptureFromReading(r: S3MeterReading): FieldTestCaptureRow {
  const extended = r as S3MeterReading & {
    primaryImageKey?: string;
    onTickDialCount?: number | null;
    readsCorrectedCount?: number;
    finalReading?: string | null;
  };
  const difficulty = String(r.imageDifficulty || 'normal').toLowerCase() as ImageDifficulty;
  const { finalReading, predictedReading } = fieldTestDisplayFromReading(r);
  const correction = fieldTestReviewerCorrectionMeta(r);
  return {
    sessionId: r.id,
    s3SessionPrefix: r.s3SessionPrefix,
    s3Bucket: r.bucket,
    primaryImageKey: extended.primaryImageKey,
    capturedAt: r.dateOfReading || r.createdAt || '',
    capturedBy: r.userName || '',
    finalReading,
    predictedReading,
    imageDifficulty: difficulty,
    onTickDialCount: extended.onTickDialCount ?? null,
    readsCorrectedCount: extended.readsCorrectedCount ?? 0,
    hadUserCorrection: correction.isCorrected,
    correctedBy: correction.correctedBy,
    correctedAt: correction.correctedAt,
    correctedOnDevice: correction.correctedOnDevice,
    dialCount: r.dialCount ?? 4,
    confidence: r.confidence ?? null,
    appVersion: r.appVersion || null,
    captureTrigger: r.captureTrigger || null,
    imageSource: r.imageSource || null,
  };
}

function isFieldTestExcludedOutcome(reading: S3MeterReading): boolean {
  const feedback = String(reading.feedbackType || '').trim().toLowerCase();
  if (feedback === 'no_dials' || feedback === 'not_sure') return true;
  const status = String(reading.status || '').trim().toLowerCase();
  if (status === 'no_dials' || status === 'not_sure') return true;
  return false;
}

/** Same rules as server `isFieldTestReading` in fieldTestRoutes.js */
export function isFieldTestReading(r: S3MeterReading): boolean {
  if (isFieldTestExcludedOutcome(r)) return false;
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

/** Pacific capture day for list date filters (matches server fieldTestDateFilter). */
export function fieldTestCaptureDayKey(reading: {
  dateOfReading?: string;
  createdAt?: string;
}): string {
  return calendarDayKeyInPortalTz(reading.dateOfReading || reading.createdAt || '');
}

/** Matches ReadingsList date chips — Pacific yyyy-mm-dd in [from, to]. */
export function readingMatchesDateRangeWindow(
  reading: { dateOfReading?: string; createdAt?: string },
  window: { from: string; to: string } | null | undefined,
): boolean {
  if (!window) return true;
  const day = fieldTestCaptureDayKey(reading);
  return Boolean(day && day >= window.from && day <= window.to);
}
