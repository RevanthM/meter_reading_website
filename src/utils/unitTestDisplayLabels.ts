import type { PipelineIterationUnitTestLink } from '../services/api';
import { formatPortalAccuracyConfidencePct } from './portalMetricFormat';

export function formatUtcShort(utc: string | null | undefined): string | null {
  if (!utc?.trim()) return null;
  const t = Date.parse(utc);
  if (!Number.isFinite(t)) return utc.trim();
  try {
    return new Date(t).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return utc.trim();
  }
}

export function formatPctShort(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return formatPortalAccuracyConfidencePct(value);
}

type ResultsSummaryInput = {
  pipelineDisplayName?: string | null;
  pipelineId?: string | null;
  generatedUtc?: string | null;
  accuracyPercent?: number | null;
  imagesProcessed?: number | null;
};

/** Compact line for cards and snapshots — no filenames. */
export function formatUnitTestResultsSummary(input: ResultsSummaryInput): string {
  const parts: string[] = [];
  const date = formatUtcShort(input.generatedUtc);
  if (date) parts.push(date);
  const acc = formatPctShort(input.accuracyPercent);
  if (acc) parts.push(acc);
  if (input.imagesProcessed != null && Number.isFinite(input.imagesProcessed)) {
    parts.push(`${input.imagesProcessed.toLocaleString()} images`);
  }
  if (parts.length > 0) return parts.join(' · ');
  const pipeline = input.pipelineDisplayName?.trim() || input.pipelineId?.trim();
  return pipeline || 'Unit test results';
}

export function formatUnitTestSourceLabel(
  iterationLabel: string,
  link: PipelineIterationUnitTestLink,
): string {
  const summary = formatUnitTestResultsSummary({
    pipelineDisplayName: link.pipelineDisplayName,
    pipelineId: link.pipelineId,
    generatedUtc: link.generatedUtc,
    accuracyPercent: link.accuracyPercent,
    imagesProcessed: link.imagesProcessed,
  });
  if (summary === 'Unit test results') return iterationLabel;
  return `${iterationLabel} · ${summary}`;
}

export function formatUnitTestRunCardHeadline(run: {
  runTimestamp?: string | null;
  generatedUtc?: string | null;
  accuracyPercent?: number | null;
  imagesProcessed?: number | null;
  pipelineDisplayName?: string | null;
  pipelineId?: string | null;
}): string {
  return formatUnitTestResultsSummary({
    pipelineDisplayName: run.pipelineDisplayName,
    pipelineId: run.pipelineId,
    generatedUtc: run.generatedUtc ?? run.runTimestamp,
    accuracyPercent: run.accuracyPercent,
    imagesProcessed: run.imagesProcessed,
  });
}
