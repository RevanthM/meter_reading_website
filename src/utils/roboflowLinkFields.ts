import type { PipelineIterationRoboflowVersionLink } from '../services/api';
import type { RoboflowVersionDetail } from '../services/roboflowApi';

export function mergeRoboflowVersionDetailIntoLink(
  base: PipelineIterationRoboflowVersionLink,
  detail: RoboflowVersionDetail,
): PipelineIterationRoboflowVersionLink {
  return {
    ...base,
    version: detail.version,
    modelTypeDisplay: detail.modelTypeDisplay,
    versionName: detail.versionName,
    imageCount: detail.imageCount,
    splits: detail.splits,
    versionCreatedAt: detail.versionCreatedAt,
    lastTrainedAt: detail.lastTrainedAt,
    trainStatus: detail.trainStatus,
    mapPercent: detail.mapPercent,
    precisionPercent: detail.precisionPercent,
    recallPercent: detail.recallPercent,
    checkpoint: detail.checkpoint,
    modelId: detail.modelId,
  };
}

export function formatRoboflowDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRoboflowPercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n}%`;
}
