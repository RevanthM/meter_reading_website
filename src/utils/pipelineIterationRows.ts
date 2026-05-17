import type { PipelineIterationRecord } from '../services/api';

export function upsertPipelineIterationRow(
  prev: PipelineIterationRecord[],
  row: PipelineIterationRecord,
): PipelineIterationRecord[] {
  const ix = prev.findIndex((x) => x.id === row.id);
  if (ix === -1) return [...prev, row];
  const next = [...prev];
  next[ix] = row;
  return next;
}

export function removePipelineIterationRow(
  prev: PipelineIterationRecord[],
  id: string,
): PipelineIterationRecord[] {
  return prev.filter((r) => r.id !== id);
}

/** Best-effort last-edit time for sorting (explicit updatedAt, then links/weights, then startDate). */
export function iterationEditSortKey(r: PipelineIterationRecord): number {
  const explicit = Date.parse(r.updatedAt || '');
  if (Number.isFinite(explicit)) return explicit;

  let best = 0;
  for (const link of r.linkedUnitTests ?? []) {
    const t = Date.parse(link.linkedAt || link.generatedUtc || '') || 0;
    if (t > best) best = t;
  }
  const weights = r.modelWeights;
  for (const w of [weights?.dialDetection, weights?.keypoint]) {
    const t = Date.parse(w?.uploadedAt || '') || 0;
    if (t > best) best = t;
  }
  if (best > 0) return best;

  const start = Date.parse(r.startDate || '');
  return Number.isFinite(start) ? start : 0;
}

export function compareIterationsByEditDateDesc(
  a: PipelineIterationRecord,
  b: PipelineIterationRecord,
): number {
  const da = iterationEditSortKey(b) - iterationEditSortKey(a);
  if (da !== 0) return da;
  const pa = a.pipeline.localeCompare(b.pipeline);
  if (pa !== 0) return pa;
  return b.iterationNumber - a.iterationNumber;
}

export function sortIterationsByEditDateDesc(
  list: PipelineIterationRecord[],
): PipelineIterationRecord[] {
  return [...list].sort(compareIterationsByEditDateDesc);
}

export function touchIterationUpdatedAt(row: PipelineIterationRecord): PipelineIterationRecord {
  return { ...row, updatedAt: new Date().toISOString() };
}

/** Row ids of the most recently edited shipped iteration per pipeline name. */
export function newestShippedIterationIdsByPipeline(
  rows: PipelineIterationRecord[],
  isShipped: (row: PipelineIterationRecord) => boolean,
): Set<string> {
  const bestByPipeline = new Map<string, PipelineIterationRecord>();
  for (const row of rows) {
    if (!isShipped(row)) continue;
    const pipelineKey = row.pipeline.trim().toLowerCase() || '(unnamed)';
    const prev = bestByPipeline.get(pipelineKey);
    if (!prev) {
      bestByPipeline.set(pipelineKey, row);
      continue;
    }
    const a = iterationEditSortKey(row);
    const b = iterationEditSortKey(prev);
    if (a > b || (a === b && row.iterationNumber > prev.iterationNumber)) {
      bestByPipeline.set(pipelineKey, row);
    }
  }
  return new Set([...bestByPipeline.values()].map((r) => r.id));
}

export function iterationDeleteConfirmMessage(
  row: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber'>,
): string {
  const label = row.pipeline.trim()
    ? `${row.pipeline.trim()} #${row.iterationNumber}`
    : `iteration #${row.iterationNumber}`;
  return (
    `Delete “${label}” from the registry?\n\n` +
    'This syncs to S3 immediately. Linked unit-test CSVs and Roboflow metadata on the row are removed; weight files already uploaded under this iteration id may remain in S3.'
  );
}
