import type { PipelineIterationRecord } from '../services/api';

/** S3 folder under `{workType}/Weights/` — matches server `buildIterationWeightsFolderName`. */
export function buildIterationWeightsFolderName(
  row: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber' | 'modelId'>,
): string {
  const pipeline = String(row.pipeline ?? 'iteration').trim() || 'iteration';
  const n = row.iterationNumber;
  const iter = Number.isFinite(n) ? n : 0;
  let name = `${pipeline}-iter-${iter}`;
  const model = String(row.modelId ?? '').trim();
  if (model) name += `_${model}`;
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function iterationWeightsS3Prefix(
  row: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber' | 'modelId'>,
  workType = '1000',
): string {
  return `${workType}/Weights/${buildIterationWeightsFolderName(row)}/`;
}
