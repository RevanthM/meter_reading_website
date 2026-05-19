import type { ReadingStatus } from '../types';

/** Mirrors server `STATUS_FOLDER_MAP` + `buildTargetSessionPrefixFromSource`. */
const STATUS_FOLDER_SUFFIX: Partial<Record<ReadingStatus, string>> = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
};

export function normalizeS3SessionPrefix(p: string | undefined | null): string {
  const s = String(p || '').trim();
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

/** Target prefix after bulk-move (same rules as server). */
export function buildTargetSessionPrefixFromSource(
  sourcePrefix: string,
  sourceType: 'field' | 'simulator',
  targetStatus: ReadingStatus,
): string | null {
  const normalized = sourcePrefix.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const sessionFolder = parts.pop();
  parts.pop();
  const modePrefix = sourceType === 'field' ? 'f_' : 's_';
  const tgtSuffix = STATUS_FOLDER_SUFFIX[targetStatus] || 'incorrect';
  const newStatusSeg = `${modePrefix}${tgtSuffix}`;
  parts.push(newStatusSeg, sessionFolder!);
  return `${parts.join('/')}/`;
}
