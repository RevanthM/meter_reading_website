import type { ImageDifficulty } from '../services/api';

/** Typical analog gas meter dial count for unit-test editing UI. */
export const DEFAULT_METER_DIAL_COUNT = 4;

export const UNIT_TEST_DIFFICULTY_LABELS: Record<NonNullable<ImageDifficulty> | 'normal', string> = {
  normal: 'Normal',
  difficult: 'Difficult',
  very_difficult: 'Very difficult',
};

export function difficultyToCode(difficulty: ImageDifficulty | string | null | undefined): 'd1' | 'd2' | 'd3' {
  const d = String(difficulty || 'normal')
    .trim()
    .toLowerCase();
  if (d === 'difficult') return 'd2';
  if (d === 'very_difficult' || d === 'very difficult') return 'd3';
  return 'd1';
}

export function normalizeUnitTestDifficulty(
  raw: ImageDifficulty | string | null | undefined,
): 'normal' | 'difficult' | 'very_difficult' {
  const d = String(raw || 'normal')
    .trim()
    .toLowerCase();
  if (d === 'difficult') return 'difficult';
  if (d === 'very_difficult' || d === 'very difficult') return 'very_difficult';
  return 'normal';
}

export type ParsedUnitTestFileName = {
  prefix: string;
  difficultyCode: 'd1' | 'd2' | 'd3';
  difficulty: 'normal' | 'difficult' | 'very_difficult';
  expected: string;
};

/**
 * Parse `{prefix}_{reading}.ext` (legacy) or `{prefix}_d{1|2|3}_{reading}.ext`.
 */
export function parseUnitTestImageFileName(fileName: string): ParsedUnitTestFileName | null {
  const base = String(fileName || '').split('/').pop() || '';
  const mNew = /^(\d+)_d([123])_(\d+)\./i.exec(base);
  if (mNew) {
    const difficultyCode = `d${mNew[2]}` as 'd1' | 'd2' | 'd3';
    return {
      prefix: mNew[1],
      difficultyCode,
      difficulty: normalizeUnitTestDifficulty(
        difficultyCode === 'd2' ? 'difficult' : difficultyCode === 'd3' ? 'very_difficult' : 'normal',
      ),
      expected: mNew[3],
    };
  }
  const mOld = /^(\d+)_(\d+)\./i.exec(base);
  if (mOld) {
    return {
      prefix: mOld[1],
      difficultyCode: 'd1',
      difficulty: 'normal',
      expected: mOld[2],
    };
  }
  return null;
}

/** How many dial pickers to show — from the reading length, not the filename prefix. */
export function meterDialCountFromExpected(expected: string): number {
  const digits = String(expected ?? '').replace(/\D/g, '');
  if (digits.length > 0) return Math.min(12, digits.length);
  return DEFAULT_METER_DIAL_COUNT;
}

export function normalizeDialDigit(v: number): number {
  return ((Math.round(v) % 10) + 10) % 10;
}

export function dialDigitsFromExpected(expected: string, dialCount?: number): number[] {
  const count = dialCount ?? meterDialCountFromExpected(expected);
  const digits = String(expected ?? '').replace(/\D/g, '');
  const padded = digits.padStart(Math.max(1, count), '0').slice(-Math.max(1, count));
  return padded.split('').map((ch) => normalizeDialDigit(parseInt(ch, 10)));
}

export function expectedFromDialDigits(digits: number[]): string {
  return digits.map((d) => String(normalizeDialDigit(d))).join('');
}

export function formatUnitTestDifficultyTag(difficulty: ImageDifficulty | string | null | undefined): string {
  return UNIT_TEST_DIFFICULTY_LABELS[normalizeUnitTestDifficulty(difficulty)];
}
