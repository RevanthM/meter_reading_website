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

function parseBoolish(raw: string | undefined): boolean | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  return null;
}

/** Per-dial digit match rate from iOS `dialN_digit_match` columns (%). */
function dialDigitMatchPct(rows: Record<string, string>[] | undefined, dial: number): number | null {
  if (!rows?.length) return null;
  const key = `dial${dial}_digit_match`;
  let n = 0;
  let hit = 0;
  for (const row of rows) {
    const b = parseBoolish(row[key]);
    if (b == null) continue;
    n += 1;
    if (b) hit += 1;
  }
  if (n === 0) return null;
  return Math.round((1000 * hit) / n) / 10;
}

export type ApplyUnitTestMetricsResult = {
  metrics: PipelineIterationManualMetrics;
  appliedLabels: string[];
};

export function applyUnitTestDetailToManualMetrics(
  summary: UnitTestCsvSummary,
  perImageRows?: Record<string, string>[] | null,
  existing?: PipelineIterationManualMetrics | null,
): ApplyUnitTestMetricsResult {
  const next: PipelineIterationManualMetrics = { ...(existing ?? {}) };
  const appliedLabels: string[] = [];

  const acc = summary.accuracyPercent;
  if (acc != null && Number.isFinite(acc)) {
    next.exactReadingAccuracyPct = acc;
    next.readAccuracyUt = acc;
    appliedLabels.push('Exact reading accuracy', 'Read acc. UT');
  }

  const n = summary.imagesProcessed;
  if (n != null && Number.isFinite(n) && n > 0) {
    next.unitTestImagesLaptop = n;
    appliedLabels.push('UT images (laptop)');
  }

  const dialKeys: (keyof PipelineIterationManualMetrics)[] = [
    'dial1UtPct',
    'dial2UtPct',
    'dial3UtPct',
    'dial4UtPct',
  ];
  for (let d = 1; d <= 4; d += 1) {
    const pct = dialDigitMatchPct(perImageRows ?? undefined, d);
    if (pct != null) {
      next[dialKeys[d - 1]!] = pct;
      appliedLabels.push(`Dial ${d} UT`);
    }
  }

  return { metrics: next, appliedLabels };
}

/** @deprecated Use applyUnitTestDetailToManualMetrics */
export function applyUnitTestSummaryToManualMetrics(
  summary: UnitTestCsvSummary,
  existing?: PipelineIterationManualMetrics | null,
): PipelineIterationManualMetrics {
  return applyUnitTestDetailToManualMetrics(summary, null, existing).metrics;
}

export function pickNewestLink(links: PipelineIterationUnitTestLink[]): PipelineIterationUnitTestLink | null {
  if (!links.length) return null;
  return [...links].sort((a, b) => {
    const ta = Date.parse(a.generatedUtc || a.linkedAt || '') || 0;
    const tb = Date.parse(b.generatedUtc || b.linkedAt || '') || 0;
    return tb - ta;
  })[0];
}
