import type { FieldTestCaptureRow, ImageDifficulty, S3MeterReading } from '../services/api';
import { matchesFieldTestCityFilter } from './fieldTestLocation';
import {
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  type UnitTestImageDifficultyFilter,
  matchesUnitTestImageDifficulty,
  matchesUnitTestImageQuery,
} from './unitTestImageFilters';

export type FieldTestCaptureFilters = {
  query: string;
  difficulty: UnitTestImageDifficultyFilter;
  user: string;
  corrected: 'all' | 'yes' | 'no';
  /** City group id from filterOptions.cities, or `all`. */
  location: string;
};

export { UNIT_TEST_DIFFICULTY_FILTER_OPTIONS };

export function filterFieldTestCaptures(
  captures: FieldTestCaptureRow[],
  filters: FieldTestCaptureFilters,
): FieldTestCaptureRow[] {
  return captures.filter((cap) => {
    if (!matchesUnitTestImageQuery(
      { fileName: cap.sessionId, expectedMeterValue: cap.finalReading },
      filters.query,
    )) {
      return false;
    }
    if (
      !matchesUnitTestImageDifficulty(
        { fileName: cap.sessionId, imageDifficulty: cap.imageDifficulty as ImageDifficulty },
        filters.difficulty,
      )
    ) {
      return false;
    }
    if (filters.user !== 'all' && (cap.capturedBy || '').trim() !== filters.user) return false;
    if (filters.corrected === 'yes' && !cap.hadUserCorrection) return false;
    if (filters.corrected === 'no' && cap.hadUserCorrection) return false;
    return true;
  });
}

export function filterFieldTestReadings(
  readings: S3MeterReading[],
  filters: FieldTestCaptureFilters,
): S3MeterReading[] {
  return readings.filter((r) => {
    if (
      !matchesUnitTestImageQuery(
        { fileName: r.id, expectedMeterValue: r.expectedValue || r.meterValue },
        filters.query,
      )
    ) {
      return false;
    }
    if (
      !matchesUnitTestImageDifficulty(
        { fileName: r.id, imageDifficulty: r.imageDifficulty as ImageDifficulty },
        filters.difficulty,
      )
    ) {
      return false;
    }
    if (filters.user !== 'all' && (r.userName || '').trim() !== filters.user) return false;
    if (filters.corrected === 'yes' && !r.hadUserCorrection) return false;
    if (filters.corrected === 'no' && r.hadUserCorrection) return false;
    if (!matchesFieldTestCityFilter(r, filters.location)) return false;
    return true;
  });
}

export function fieldTestFiltersActive(filters: FieldTestCaptureFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.difficulty !== 'all' ||
    filters.user !== 'all' ||
    filters.corrected !== 'all' ||
    (filters.location !== 'all' && filters.location.trim().length > 0)
  );
}
