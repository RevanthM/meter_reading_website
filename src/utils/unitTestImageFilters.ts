import type { UnitTestImageRow } from '../services/api';
import { normalizeUnitTestDifficulty, parseUnitTestImageFileName } from './unitTestImageNaming';

export type UnitTestImageDifficultyFilter = 'all' | 'normal' | 'difficult' | 'very_difficult';

export const UNIT_TEST_DIFFICULTY_FILTER_OPTIONS: {
  id: UnitTestImageDifficultyFilter;
  label: string;
}[] = [
  { id: 'all', label: 'All difficulties' },
  { id: 'normal', label: 'Normal' },
  { id: 'difficult', label: 'Difficult' },
  { id: 'very_difficult', label: 'Very difficult' },
];

export type UnitTestImageListFilters = {
  query: string;
  difficulty: UnitTestImageDifficultyFilter;
};

export function resolveImageDifficulty(
  img: Pick<UnitTestImageRow, 'fileName' | 'imageDifficulty'>,
): 'normal' | 'difficult' | 'very_difficult' {
  if (img.imageDifficulty) {
    return normalizeUnitTestDifficulty(img.imageDifficulty);
  }
  const parsed = parseUnitTestImageFileName(img.fileName);
  return parsed?.difficulty ?? 'normal';
}

/** Match file name, ground truth, or reading digits embedded in the name. */
export function matchesUnitTestImageQuery(
  img: Pick<UnitTestImageRow, 'fileName' | 'expectedMeterValue'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digitsOnly = q.replace(/\D/g, '');
  if (img.fileName.toLowerCase().includes(q)) return true;
  const expected = (img.expectedMeterValue ?? '').trim();
  if (expected && expected.toLowerCase().includes(q)) return true;
  if (digitsOnly.length > 0) {
    if (expected.replace(/\D/g, '').includes(digitsOnly)) return true;
    const parsed = parseUnitTestImageFileName(img.fileName);
    if (parsed?.expected.replace(/\D/g, '').includes(digitsOnly)) return true;
  }
  return false;
}

export function matchesUnitTestImageDifficulty(
  img: Pick<UnitTestImageRow, 'fileName' | 'imageDifficulty'>,
  difficulty: UnitTestImageDifficultyFilter,
): boolean {
  if (difficulty === 'all') return true;
  return resolveImageDifficulty(img) === difficulty;
}

export function filterUnitTestImages(
  images: UnitTestImageRow[],
  filters: UnitTestImageListFilters,
): UnitTestImageRow[] {
  return images.filter(
    (img) =>
      matchesUnitTestImageQuery(img, filters.query) &&
      matchesUnitTestImageDifficulty(img, filters.difficulty),
  );
}

export function unitTestImageFiltersActive(filters: UnitTestImageListFilters): boolean {
  return filters.query.trim().length > 0 || filters.difficulty !== 'all';
}
