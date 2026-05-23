import type { PipelineIterationRecord } from '../services/api';
import { filterEvalChartRows } from '../constants/pipelineChartTheme';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';
import { inferProductLineForRow } from '../constants/factoryStages';

const STORAGE_KEY = 'meter_portal_report_iteration_ids';

export function getStoredReportIterationIds(): Set<string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    return null;
  }
}

export function setStoredReportIterationIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Newest eval iteration id, optionally scoped to one pipeline line. */
export function latestReportIterationId(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter = 'all',
): string | null {
  let scoped = filterEvalChartRows(rows);
  if (pipelineFilter !== 'all') {
    scoped = scoped.filter((r) => inferProductLineForRow(r) === pipelineFilter);
  }
  if (!scoped.length) return null;
  const latest = [...scoped].sort((a, b) => b.iterationNumber - a.iterationNumber)[0];
  return latest?.id ?? null;
}

/** Default report selection: only the most recent iteration (for the active pipeline filter). */
export function defaultReportIterationIds(
  rows: PipelineIterationRecord[],
  pipelineFilter: ChartPipelineFilter = 'all',
): Set<string> {
  const id = latestReportIterationId(rows, pipelineFilter);
  return id ? new Set([id]) : new Set();
}

export function filterRowsByReportSelection(
  rows: PipelineIterationRecord[],
  selectedIds: Set<string>,
): PipelineIterationRecord[] {
  if (!selectedIds.size) return [];
  return rows.filter((r) => selectedIds.has(r.id));
}
