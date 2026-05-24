import type { PipelineIterationRecord, UnitTestRunIndexRow } from '../services/api';
import {
  inferProductLine,
  inferProductLineForRow,
  type FactoryProductLine,
} from '../constants/factoryStages';
import { modelIdMatchesUnitTest } from './unitTestIterationLink';

export type EnrichedUnitTestRun = UnitTestRunIndexRow & {
  iterationNumber: number | null;
  registryPipeline: string | null;
  productLine: FactoryProductLine;
  runTimestamp: string | null;
};

export function runTimestampIso(run: UnitTestRunIndexRow): string | null {
  return run.generatedUtc?.trim() || run.lastModified?.trim() || null;
}

export function buildLinkedIterationByS3Key(
  iterations: PipelineIterationRecord[],
): Map<string, PipelineIterationRecord> {
  const map = new Map<string, PipelineIterationRecord>();
  for (const row of iterations) {
    for (const link of row.linkedUnitTests ?? []) {
      const key = link.s3Key?.trim();
      if (key) map.set(key, row);
    }
  }
  return map;
}

function resolveIterationForRun(
  run: UnitTestRunIndexRow,
  linkedByKey: Map<string, PipelineIterationRecord>,
  iterations: PipelineIterationRecord[],
): PipelineIterationRecord | null {
  const linked = linkedByKey.get(run.key);
  if (linked) return linked;

  const linkMeta = {
    s3Key: run.key,
    fileName: run.fileName,
    pipelineId: run.pipelineId ?? undefined,
  };

  let candidates = iterations.filter((row) => modelIdMatchesUnitTest(row.modelId, linkMeta));
  if (!candidates.length && run.pipelineId) {
    const pid = run.pipelineId.trim().toLowerCase();
    candidates = iterations.filter((row) => {
      const mid = row.modelId.trim().toLowerCase();
      const pipe = row.pipeline.trim().toLowerCase();
      return mid === pid || mid.includes(pid) || pid.includes(mid) || pipe.includes(pid);
    });
  }
  if (!candidates.length && run.pipelineDisplayName) {
    const name = run.pipelineDisplayName.trim().toLowerCase();
    candidates = iterations.filter((row) => row.pipeline.trim().toLowerCase().includes(name));
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;

  const appVer = run.appVersion?.trim().toLowerCase();
  if (appVer) {
    const withApp = candidates.filter((r) => r.appVersion.trim().toLowerCase() === appVer);
    if (withApp.length === 1) return withApp[0]!;
    if (withApp.length > 1) {
      return [...withApp].sort((a, b) => b.iterationNumber - a.iterationNumber)[0]!;
    }
  }

  return [...candidates].sort((a, b) => b.iterationNumber - a.iterationNumber)[0]!;
}

export function enrichUnitTestRuns(
  runs: UnitTestRunIndexRow[],
  iterations: PipelineIterationRecord[],
): EnrichedUnitTestRun[] {
  const linkedByKey = buildLinkedIterationByS3Key(iterations);
  return runs.map((run) => {
    const iteration = resolveIterationForRun(run, linkedByKey, iterations);
    const productLine = iteration
      ? inferProductLineForRow(iteration)
      : inferProductLine(run.pipelineId ?? run.pipelineDisplayName ?? '');
    return {
      ...run,
      iterationNumber: iteration?.iterationNumber ?? null,
      registryPipeline: iteration?.pipeline.trim() || run.pipelineDisplayName?.trim() || run.pipelineId?.trim() || null,
      productLine,
      runTimestamp: runTimestampIso(run),
    };
  });
}

export function pipelineBadgeLabel(run: EnrichedUnitTestRun): string {
  return run.registryPipeline || run.pipelineDisplayName?.trim() || run.pipelineId?.trim() || '—';
}
