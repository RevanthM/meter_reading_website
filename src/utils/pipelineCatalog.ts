import type { PipelineIterationRecord } from '../services/api';

/** Canonical pipeline choices — labels match May 2026 spreadsheet. */
export const PIPELINE_CATALOG = [
  {
    id: 'pipeline_1',
    label: 'Sempra -1 (p1)',
    value: 'Sempra -1',
    modelPrefix: 'sempra.p1',
  },
  {
    id: 'pipeline_2',
    label: 'Anica - 2 (p2)',
    value: 'Anica - 2',
    modelPrefix: 'anica.p2',
  },
  {
    id: 'pipeline_3',
    label: 'Sempra_Anica - 3 (p3)',
    value: 'Sempra_Anica - 3',
    modelPrefix: 'combined.p3',
  },
] as const;

export type PipelineCatalogId = (typeof PIPELINE_CATALOG)[number]['id'];

export function getPipelineCatalogOption(id: PipelineCatalogId) {
  const opt = PIPELINE_CATALOG.find((o) => o.id === id);
  if (!opt) throw new Error(`Unknown pipeline id: ${id}`);
  return opt;
}

/** Map stored pipeline label (incl. legacy names) → catalog id. */
export function matchPipelineToCatalog(pipeline: string): PipelineCatalogId | null {
  const raw = pipeline.trim();
  if (!raw) return null;

  for (const opt of PIPELINE_CATALOG) {
    if (raw === opt.value) return opt.id;
  }

  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (
    compact.includes('sempra') &&
    (compact.includes('anica') || compact.includes('combined') || compact.includes('hybrid'))
  ) {
    return 'pipeline_3';
  }
  if (compact.includes('combined') || compact.includes('hybrid')) return 'pipeline_3';
  if (compact.includes('sempra') || compact.endsWith('1') || compact.includes('pipeline1')) {
    return 'pipeline_1';
  }
  if (compact.includes('anica') || compact.endsWith('2') || compact.includes('pipeline2')) {
    return 'pipeline_2';
  }
  return null;
}

export function rowsForCatalogPipeline(
  rows: PipelineIterationRecord[],
  catalogId: PipelineCatalogId,
  excludeRowId?: string,
): PipelineIterationRecord[] {
  return rows.filter((r) => {
    if (excludeRowId && r.id === excludeRowId) return false;
    return matchPipelineToCatalog(r.pipeline) === catalogId;
  });
}

/** Parse trailing version from model ids like `combined.p3.2` or bare `sempra.p1` (→ 1). */
export function parseModelVersionSuffix(modelId: string, modelPrefix: string): number | null {
  const m = modelId.trim().toLowerCase();
  const p = modelPrefix.trim().toLowerCase();
  if (!m || !p) return null;
  if (m === p) return 1;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = m.match(new RegExp(`^${escaped}\\.(\\d+)$`));
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatModelId(modelPrefix: string, version: number): string {
  return `${modelPrefix}.${Math.max(1, version)}`;
}

/** Next iteration # and model id (e.g. combined.p3.3) from existing rows on this pipeline. */
export function suggestNextIterationAndModel(
  rows: PipelineIterationRecord[],
  catalogId: PipelineCatalogId,
  excludeRowId?: string,
): { iterationNumber: number; modelId: string } {
  const opt = getPipelineCatalogOption(catalogId);
  const peers = rowsForCatalogPipeline(rows, catalogId, excludeRowId);

  let maxIter = 0;
  let maxModelVer = 0;
  for (const r of peers) {
    if (Number.isFinite(r.iterationNumber) && r.iterationNumber > 0) {
      maxIter = Math.max(maxIter, r.iterationNumber);
    }
    const ver = parseModelVersionSuffix(r.modelId, opt.modelPrefix);
    if (ver != null) maxModelVer = Math.max(maxModelVer, ver);
  }

  const next = Math.max(maxIter, maxModelVer, 0) + 1;
  return {
    iterationNumber: next,
    modelId: formatModelId(opt.modelPrefix, next),
  };
}
