/** Infer portal queue status and field/simulator source from an S3 session prefix. */

export const FOLDER_SUFFIX_TO_STATUS = {
  correct: 'correct',
  incorrect: 'incorrect_new',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
  skipped_review: 'incorrect_new',
};

export function normalizeS3SessionPrefix(p) {
  if (typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function inferStatusAndSourceFromSessionPrefix(prefix) {
  const norm = normalizeS3SessionPrefix(prefix);
  const parts = norm.split('/').filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i];
    if (seg === 'manually_uploaded') {
      return { status: 'manually_uploaded', sourceType: 'simulator' };
    }
    if (seg === 'correct') return { status: 'correct', sourceType: 'field' };
    if (seg === 'incorrect') return { status: 'incorrect_new', sourceType: 'field' };
    if (seg.startsWith('f_')) {
      const suffix = seg.slice(2);
      return {
        status: FOLDER_SUFFIX_TO_STATUS[suffix] || 'incorrect_new',
        sourceType: 'field',
      };
    }
    if (seg.startsWith('s_')) {
      const suffix = seg.slice(2);
      return {
        status: FOLDER_SUFFIX_TO_STATUS[suffix] || 'incorrect_new',
        sourceType: 'simulator',
      };
    }
  }
  return { status: 'incorrect_new', sourceType: 'field' };
}

/** Derive session prefix from S3 object key ending in metadata.json */
export function sessionPrefixFromMetadataKey(objectKey) {
  const key = String(objectKey || '').trim();
  if (!key.endsWith('metadata.json')) return null;
  return normalizeS3SessionPrefix(key.slice(0, -'metadata.json'.length));
}
