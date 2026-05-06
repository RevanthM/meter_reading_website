import type { MeterReading, DashboardCounts, WorkType } from '../types';
import type { DataSource } from '../context/ReadingsContext';

const API_BASE_URL = '/api';

/** Parse successful API body text; if HTML slipped through (SPA fallback), explain likely cause. */
function parseJsonBody<T>(text: string, httpStatus: number): T {
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error(
      'API returned HTML instead of JSON — the request never reached the Node server (or it returned a web page). Run `npm run server` on port 3001 and use `npm run dev` so `/api` is proxied from Vite.',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Invalid JSON from API (HTTP ${httpStatus}). Start: ${text.slice(0, 100).replace(/\s+/g, ' ')}…`,
    );
  }
}

export interface S3MeterReading extends MeterReading {
  /** Exact S3 session prefix (…/sessionId/) for server-side moves. */
  s3SessionPrefix?: string;
  rawPrediction?: string;
  isCorrect?: boolean;
  confidence?: number;
  processingTimeMs?: number;
  dialCount?: number;
  dialDetails?: Array<{
    dial: number;
    prediction: number;
    direction: string;
    confidence: number;
  }>;
  bucket?: string;
  /** App work-type code from metadata (e.g. METR) or portal filter code. */
  workType?: string;
  /** iOS app / bundle generation tag from metadata (`app_version`). */
  appVersion?: string;
  conditionCode?: string;
  userName?: string;
  imageSource?: string;
  uploadMode?: string;
  feedbackType?: string;
}

export interface WorkTypeInfo {
  code: WorkType;
  name: string;
}

export async function fetchWorkTypes(): Promise<WorkTypeInfo[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/work-types`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch work types:', error);
    throw error;
  }
}

export async function fetchReadings(source?: DataSource, workType?: WorkType): Promise<S3MeterReading[]> {
  try {
    const params = new URLSearchParams();
    if (source && source !== 'all') params.set('source', source);
    if (workType) params.set('workType', workType);
    
    const url = params.toString() 
      ? `${API_BASE_URL}/readings?${params}`
      : `${API_BASE_URL}/readings`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch readings:', error);
    throw error;
  }
}

export interface ModelVersionStats {
  appVersion: string;
  sessions: number;
  /** Total image files across sessions (original + dial crops, etc.). */
  imageCount?: number;
  statusCounts: Record<string, number>;
  correctCount: number;
  incorrectTotal: number;
  notSureCount: number;
  noDialsCount: number;
  queueCorrectRate: number;
  queueIncorrectRate: number;
  notSureRate: number;
  noDialsRate: number;
  avgConfidence: number | null;
  avgProcessingTimeMs: number | null;
  avgDialCount: number | null;
  fieldCount: number;
  simulatorCount: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
}

export interface ModelAnalyticsResponse {
  currentVersion: string | null;
  versions: ModelVersionStats[];
  computedAt: string;
}

export interface UsageDayRow {
  date: string;
  sessions: number;
  images: number;
  distinctUsers: number;
}

export interface UsageUserRow {
  userKey: string;
  sessions: number;
  images: number;
  lastSeen: string;
}

export interface UsageSummaryResponse {
  workType: string;
  source: string;
  daysEffective: number;
  totals: { sessions: number; images: number; distinctUsers: number };
  byDay: UsageDayRow[];
  byUser: UsageUserRow[];
  windowStartUtc: string;
  windowEndUtc: string;
  sessionCountAllScanned: number;
  sessionCountInWindow: number;
  computedAt: string;
  note?: string;
}

export async function fetchModelAnalytics(
  source?: DataSource,
  workType?: WorkType,
): Promise<ModelAnalyticsResponse> {
  const params = new URLSearchParams();
  if (source && source !== 'all') params.set('source', source);
  if (workType) params.set('workType', workType);
  const q = params.toString();
  const url = q ? `${API_BASE_URL}/model-analytics?${q}` : `${API_BASE_URL}/model-analytics`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    const t = text.trim();
    let msg = `HTTP ${response.status}`;
    if (t.startsWith('<')) {
      msg =
        'API returned HTML instead of JSON. Start the Node API: `npm run server` (port 3001), and keep the UI on `npm run dev` so `/api` proxies to it.';
    } else if (t.startsWith('{')) {
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep msg */
      }
    }
    throw new Error(msg);
  }
  return parseJsonBody<ModelAnalyticsResponse>(text, response.status);
}

export async function fetchUsageSummary(
  source: DataSource | undefined,
  workType: WorkType,
  days: number,
): Promise<UsageSummaryResponse> {
  const params = new URLSearchParams();
  if (source && source !== 'all') params.set('source', source);
  if (workType) params.set('workType', workType);
  params.set('days', String(Math.min(90, Math.max(1, days))));
  const url = `${API_BASE_URL}/usage-summary?${params.toString()}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    const t = text.trim();
    let msg = `HTTP ${response.status}`;
    if (t.startsWith('<')) {
      msg =
        'API returned HTML instead of JSON. Start the Node API: `npm run server` (port 3001), and keep the UI on `npm run dev` so `/api` proxies to it.';
    } else if (t.startsWith('{')) {
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep msg */
      }
    }
    throw new Error(msg);
  }
  return parseJsonBody<UsageSummaryResponse>(text, response.status);
}

export async function fetchCounts(source?: DataSource, workType?: WorkType): Promise<DashboardCounts> {
  try {
    const params = new URLSearchParams();
    if (source && source !== 'all') params.set('source', source);
    if (workType) params.set('workType', workType);
    
    const url = params.toString()
      ? `${API_BASE_URL}/counts?${params}`
      : `${API_BASE_URL}/counts`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch counts:', error);
    throw error;
  }
}

export async function fetchReadingById(id: string, workType?: WorkType): Promise<S3MeterReading | null> {
  try {
    const q = workType ? `?workType=${encodeURIComponent(workType)}` : '';
    const response = await fetch(`${API_BASE_URL}/readings/${encodeURIComponent(id)}${q}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch reading:', error);
    throw error;
  }
}

export async function checkHealth(): Promise<{ status: string; buckets: string[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return await response.json();
  } catch {
    return { status: 'error', buckets: [] };
  }
}

export interface BulkMoveRequest {
  sessionId: string;
  sourceType: 'field' | 'simulator';
  currentStatus: string;
  targetStatus: string;
  s3SessionPrefix?: string;
}

/** Optional filters for list ZIP export (single day wins over range; app version matches metadata bucket). */
export type ListExportDateOpts = {
  date?: string;
  from?: string;
  to?: string;
  /** Exact tag after portal normalization (omit or empty in metadata → use `unknown`). */
  appVersion?: string;
};

/**
 * ZIP sessions matching the readings list (work type, source, list route, optional day or from/to range).
 * Same folder layout as incorrect bulk export (images + metadata per session).
 */
export async function downloadListRetrainZip(
  source: DataSource | undefined,
  workType: WorkType,
  listStatus: string,
  dateOpts?: ListExportDateOpts,
): Promise<void> {
  const params = new URLSearchParams({ workType, listStatus });
  if (source && source !== 'all') params.set('source', source);
  if (dateOpts?.date && /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.date)) {
    params.set('date', dateOpts.date);
  } else if (
    dateOpts?.from &&
    dateOpts?.to &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.to)
  ) {
    params.set('from', dateOpts.from);
    params.set('to', dateOpts.to);
  }
  if (dateOpts?.appVersion != null && String(dateOpts.appVersion).trim() !== '') {
    params.set('appVersion', String(dateOpts.appVersion).trim());
  }
  const res = await fetch(`${API_BASE_URL}/export/list-retrain-zip?${params.toString()}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `sessions-${listStatus}-${workType}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** ZIP of all incorrect_* sessions (backward compatible; same as list export with incorrect-queues). */
export async function downloadIncorrectRetrainZip(
  source: DataSource | undefined,
  workType: WorkType,
): Promise<void> {
  return downloadListRetrainZip(source, workType, 'incorrect-queues');
}

/** ZIP this session only (same folder layout as bulk incorrect export) for labeling / training. */
export async function downloadSessionRetrainZip(sessionId: string, workType: WorkType): Promise<void> {
  const params = new URLSearchParams({ sessionId, workType });
  const res = await fetch(`${API_BASE_URL}/export/session-retrain-zip?${params.toString()}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `session-${sessionId}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function bulkMoveReadings(readings: BulkMoveRequest[], userEmail?: string): Promise<{ success: boolean; moved: number }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userEmail) headers['x-user-email'] = userEmail;
    const response = await fetch(`${API_BASE_URL}/readings/bulk-move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ readings }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to bulk move readings:', error);
    throw error;
  }
}
