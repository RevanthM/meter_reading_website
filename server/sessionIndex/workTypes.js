/** Portal work-type codes and iOS S3 folder roots (shared by portal + Lambda). */

export const WORK_TYPES = ['1000', '2000', '3000', '4000', '5000'];

export const WORK_TYPE_LABELS = {
  '1000': 'Meter Reading',
  '2000': 'GO95 Electrical Pole Inspection',
  '3000': 'Riser Inspection',
  '4000': 'Leak Inspection',
  '5000': 'Intrusive Inspection',
};

export const WORK_TYPE_S3_FOLDER_PREFIXES = {
  '1000': ['1000', 'METR'],
  '2000': ['2000', 'GO95'],
  '3000': ['3000', 'RISR'],
  '4000': ['4000', 'LEAK'],
  '5000': ['5000', 'INTR'],
};

/** iOS short code → portal numeric work type. */
export const IOS_CODE_TO_PORTAL_WORK_TYPE = {
  METR: '1000',
  GO95: '2000',
  RISR: '3000',
  LEAK: '4000',
  INTR: '5000',
};

export const ALL_STATUSES = [
  'correct',
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
  'no_dials',
  'not_sure',
  'manually_uploaded',
];

export function getS3FolderRootsForPortalWorkType(workType) {
  const roots = WORK_TYPE_S3_FOLDER_PREFIXES[workType];
  if (roots?.length) return [...new Set(roots)];
  return [workType];
}

export function inferPortalWorkTypeFromMetadata(metadata, workTypeHint = '1000') {
  const raw = String(metadata?.work_type ?? metadata?.work_type_code ?? workTypeHint).trim();
  if (WORK_TYPES.includes(raw)) return raw;
  const mapped = IOS_CODE_TO_PORTAL_WORK_TYPE[raw.toUpperCase()];
  if (mapped) return mapped;
  return WORK_TYPES.includes(workTypeHint) ? workTypeHint : '1000';
}
