import type {
  PipelineIterationManualMetrics,
  PipelineIterationUnitTestLink,
  UnitTestCsvSummary,
  UnitTestRunDetailResponse,
} from '../services/api';
import { normalizeConfidencePct, resolveDialStats } from './unitTestCsvAnalytics';

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

  const runConf = normalizeConfidencePct(summary.average_confidence);
  if (runConf != null) {
    next.appAvgKeypointConfidence = runConf;
    appliedLabels.push('App avg keypoint confidence');
  }

  const detail: UnitTestRunDetailResponse = {
    key: '',
    summary,
    perImageCount: perImageRows?.length ?? 0,
    perImageRows: perImageRows ?? undefined,
  };
  const dialStats = resolveDialStats(detail);
  const appAccKeys: (keyof PipelineIterationManualMetrics)[] = [
    'appDial1AccuracyPct',
    'appDial2AccuracyPct',
    'appDial3AccuracyPct',
    'appDial4AccuracyPct',
  ];
  const appConfKeys: (keyof PipelineIterationManualMetrics)[] = [
    'appDial1ConfidencePct',
    'appDial2ConfidencePct',
    'appDial3ConfidencePct',
    'appDial4ConfidencePct',
  ];
  const utKeys: (keyof PipelineIterationManualMetrics)[] = [
    'dial1UtPct',
    'dial2UtPct',
    'dial3UtPct',
    'dial4UtPct',
  ];

  for (const stat of dialStats) {
    const idx = stat.dial - 1;
    if (idx < 0 || idx > 3) continue;
    if (stat.accuracyPct != null) {
      next[appAccKeys[idx]!] = stat.accuracyPct;
      next[utKeys[idx]!] = stat.accuracyPct;
      appliedLabels.push(`Dial ${stat.dial} app accuracy`);
    }
    if (stat.confidencePct != null) {
      next[appConfKeys[idx]!] = stat.confidencePct;
      appliedLabels.push(`Dial ${stat.dial} app confidence`);
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
