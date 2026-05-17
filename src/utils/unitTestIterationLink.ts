import type {
  PipelineIterationManualMetrics,
  PipelineIterationUnitTestLink,
  UnitTestCsvSummary,
} from '../services/api';

/** Parse iOS export stem: `results_<UTC>_<pipelineId>_<appVer>_export.csv` */
export function parseUnitTestFileName(fileName: string): {
  pipelineId: string | null;
  appVersionHint: string | null;
} {
  const base = fileName.replace(/\.csv$/i, '');
  const m = /^results_[^_]+_(.+)_export$/i.exec(base);
  if (!m) return { pipelineId: null, appVersionHint: null };
  const tail = m[1];
  const parts = tail.split('_');
  if (parts.length < 2) return { pipelineId: tail, appVersionHint: null };
  const appVersionHint = parts[parts.length - 1] ?? null;
  const pipelineId = parts.slice(0, -1).join('_');
  return { pipelineId: pipelineId || null, appVersionHint };
}

export function unitTestSummaryToLinkMeta(
  s3Key: string,
  fileName: string | undefined,
  summary: UnitTestCsvSummary,
): PipelineIterationUnitTestLink {
  const name = fileName || s3Key.split('/').pop() || s3Key;
  return {
    s3Key,
    fileName: name,
    linkedAt: new Date().toISOString(),
    pipelineId: summary.pipeline_id?.trim() || parseUnitTestFileName(name).pipelineId,
    pipelineDisplayName: summary.pipeline_display_name?.trim() || null,
    accuracyPercent:
      summary.accuracyPercent != null && Number.isFinite(summary.accuracyPercent)
        ? summary.accuracyPercent
        : null,
    imagesProcessed:
      summary.imagesProcessed != null && Number.isFinite(summary.imagesProcessed)
        ? summary.imagesProcessed
        : null,
    generatedUtc: summary.generated_utc?.trim() || null,
    appVersionHint: summary.app_version?.trim() || parseUnitTestFileName(name).appVersionHint,
  };
}

export function modelIdMatchesUnitTest(
  modelId: string,
  link: PipelineIterationUnitTestLink,
): boolean {
  const mid = modelId.trim().toLowerCase();
  if (!mid) return false;
  const pid = (link.pipelineId || '').trim().toLowerCase();
  if (pid && (pid === mid || pid.includes(mid) || mid.includes(pid))) return true;
  const fn = (link.fileName || '').toLowerCase();
  return fn.includes(mid);
}

export function applyUnitTestSummaryToManualMetrics(
  summary: UnitTestCsvSummary,
  existing?: PipelineIterationManualMetrics | null,
): PipelineIterationManualMetrics {
  const next: PipelineIterationManualMetrics = { ...(existing ?? {}) };
  const acc = summary.accuracyPercent;
  if (acc != null && Number.isFinite(acc)) {
    next.exactReadingAccuracyPct = acc;
    next.readAccuracyUt = acc;
  }
  const n = summary.imagesProcessed;
  if (n != null && Number.isFinite(n) && n > 0) {
    next.unitTestImagesLaptop = n;
  }
  return next;
}

export function pickNewestLink(links: PipelineIterationUnitTestLink[]): PipelineIterationUnitTestLink | null {
  if (!links.length) return null;
  return [...links].sort((a, b) => {
    const ta = Date.parse(a.generatedUtc || a.linkedAt || '') || 0;
    const tb = Date.parse(b.generatedUtc || b.linkedAt || '') || 0;
    return tb - ta;
  })[0];
}
