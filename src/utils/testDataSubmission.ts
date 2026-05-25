import type { S3MeterReading } from '../services/api';
import {
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from './dateRangePresets';
import { calendarDayKeyInPortalTz } from './readingDisplayDates';

export type SubmittedDatePreset = 'all' | DateRangePresetId;

/** Who queued this session for test-data review. Falls back for rows saved before submission tracking. */
export function testDataSubmittedBy(reading: S3MeterReading): string | null {
  const tracked = reading.testDataSubmittedBy?.trim();
  if (tracked) return tracked;
  if (reading.reviewerDatasetDestination === 'test' && reading.testDataReviewStatus === 'pending') {
    const legacy = reading.portalMetadataUpdatedBy?.trim();
    if (legacy) return legacy;
  }
  return null;
}

/** ISO timestamp when sent to pending test data. */
export function testDataSubmittedAtIso(reading: S3MeterReading): string | null {
  const tracked = reading.testDataSubmittedAt?.trim();
  if (tracked) return tracked;
  const by = testDataSubmittedBy(reading);
  if (by) {
    const legacy = reading.portalMetadataUpdatedAt?.trim();
    if (legacy) return legacy;
  }
  return null;
}

export function formatSubmitterLabel(email: string): string {
  const local = email.split('@')[0]?.trim();
  return local || email;
}

export function matchesSubmittedDatePreset(reading: S3MeterReading, preset: SubmittedDatePreset): boolean {
  if (preset === 'all') return true;
  if (!isDateRangePresetId(preset)) return true;
  const iso = testDataSubmittedAtIso(reading);
  if (!iso) return false;
  const day = calendarDayKeyInPortalTz(iso);
  if (!day) return false;
  const { from, to } = getDateRangeFromPreset(preset);
  return day >= from && day <= to;
}
