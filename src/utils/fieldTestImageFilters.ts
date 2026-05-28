import type { FieldTestCaptureRow, ImageDifficulty } from '../services/api';
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

export function fieldTestFiltersActive(filters: FieldTestCaptureFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.difficulty !== 'all' ||
    filters.user !== 'all' ||
    filters.corrected !== 'all'
  );
}
