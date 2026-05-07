import type { MeterReading, DashboardCounts, WorkType } from '../types';
import type { PortalWorkMode } from '../utils/portalWorkMode';
import type { DataSource } from '../context/ReadingsContext';

const API_BASE_URL = '/api';

/** Parse successful API body text; if HTML slipped through (SPA fallback), explain likely cause. */
function parseJsonBody<T>(text: string, httpStatus: number): T {
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error(
      'API returned HTML instead of JSON — usually the SPA index.html (Vite without a running API on 3001, or an old `npm run server` that does not include this route). Fix: stop and run `npm run server` on port 3001 from the project root, then use `npm run dev` and open the app on http://localhost:5173 (not file://). After `git pull`, always restart the Node server.',
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
  /** Reviewer flagged this session for the training dataset (`reviewer_recommend_training` in metadata). */
  reviewerRecommendTraining?: boolean;
  /** `is_manually_reviewed` in metadata; legacy `is_human_reviewed` is still read by the server until migrated. */
  isManuallyReviewed?: boolean;
  /** Email from `portal_metadata_updated_by` after a portal save to metadata.json. */
  portalMetadataUpdatedBy?: string;
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

/** Allowed keys for `PATCH /api/readings/:id/metadata` (merged into S3 `metadata.json`). */
export type SessionMetadataPatch = {
  user_correction?: string;
  ml_prediction?: string;
  ml_raw_prediction?: string | null;
  dial_count?: number;
  dial_details?: Array<{
    dial: number;
    prediction: number;
    direction: string;
    confidence: number;
  }>;
  is_correct?: boolean;
  condition_code?: string | null;
  portal_review_notes?: string;
  /** When true, labelers can filter the list for reviewer-recommended sessions. */
  reviewer_recommend_training?: boolean;
  /** Portal reviewer save sets true in metadata.json (replaces legacy `is_human_reviewed` on write). */
  is_manually_reviewed?: boolean;
  confidence?: number;
  processing_time_ms?: number;
};

export async function patchSessionMetadata(
  sessionId: string,
  workType: WorkType | undefined,
  body: { s3SessionPrefix: string; patch: SessionMetadataPatch },
  userEmail?: string,
  /** Server rejects metadata PATCH unless this is `reviewer`. */
  portalWorkMode: PortalWorkMode = 'reviewer',
): Promise<S3MeterReading> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-portal-work-mode': portalWorkMode,
  };
  if (userEmail) headers['x-user-email'] = userEmail;
  const response = await fetch(`${API_BASE_URL}/readings/${encodeURIComponent(sessionId)}/metadata`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      workType: workType || undefined,
      s3SessionPrefix: body.s3SessionPrefix,
      patch: body.patch,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<S3MeterReading>(text, response.status);
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
 * Flat root: raw full-frame images + dataset.json (Roboflow-friendly; no per-session folders or metadata.json).
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
  const filename = match?.[1] || `sessions-flat-${listStatus}-${workType}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Flat ZIP of incorrect-queue sessions (same as list export with listStatus=incorrect-queues). */
export async function downloadIncorrectRetrainZip(
  source: DataSource | undefined,
  workType: WorkType,
): Promise<void> {
  return downloadListRetrainZip(source, workType, 'incorrect-queues');
}

/** Flat ZIP for one session (raw photos + dataset.json at root) for Roboflow / labeling. */
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
  const filename = match?.[1] || `session-flat-${sessionId}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `weights.pt` stored at `{folderPrefix}model/weights.pt` — see `dataset.json` weights block. */
export interface TrainingPipelineWeightsSummary {
  s3Key: string | null;
  uploadedAt: string | null;
  sizeBytes: number | null;
  originalFileName: string | null;
}

export interface TrainingDatasetRow {
  folderPrefix: string;
  displayName: string;
  createdAt: string | null;
  slug: string | null;
  timestamp: number | null;
  manifestMissing?: boolean;
  /** Distinct session ids ever copied into this folder (from manifest). */
  copiedSessionCount?: number;
  lastCopyAt?: string | null;
  weights?: TrainingPipelineWeightsSummary | null;
}

export interface CopySessionsToTrainingDatasetResult {
  ok: boolean;
  copied: Array<{ sessionId: string; objectCount: number; destinationPrefix: string }>;
  errors: Array<{ sessionId: string; error: string }>;
}

export interface TrainingCopiedSessionPreview {
  sessionId: string;
  thumbUrl: string | null;
  /** Count of raw/full-frame images in the session copy (excludes `dial_*` crops). */
  imageCount: number;
}

export interface TrainingCopiedSessionsPreviewResponse {
  folderPrefix: string;
  sessions: TrainingCopiedSessionPreview[];
}

export async function fetchCopiedSessionsPreview(
  folderPrefix: string,
): Promise<TrainingCopiedSessionsPreviewResponse> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const response = await fetch(
    `${API_BASE_URL}/training-datasets/copied-sessions-preview?${params.toString()}`,
  );
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingCopiedSessionsPreviewResponse>(text, response.status);
}

export async function copySessionsToTrainingDataset(
  folderPrefix: string,
  sessions: Array<{ sessionId: string; s3SessionPrefix?: string; workType?: WorkType }>,
): Promise<CopySessionsToTrainingDatasetResult> {
  const response = await fetch(`${API_BASE_URL}/training-datasets/copy-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPrefix, sessions }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<CopySessionsToTrainingDatasetResult>(text, response.status);
}

/** ZIP all objects under a training-dataset prefix (includes dataset.json and sessions/*). */
export interface WeightsSessionPromotionSummary {
  enabled: boolean;
  sessionCountConsidered: number;
  moved: number;
  skippedAlready: number;
  skippedNotInPipeline: number;
  notFound: number;
  moveFailed: number;
}

export interface UploadTrainingWeightsResponse {
  ok: boolean;
  weights: {
    s3Key: string;
    bucket: string;
    relativeKey: string;
    uploadedAt: string;
    sizeBytes: number;
    originalFileName: string;
    contentType: string;
  };
  sessionPromotion?: WeightsSessionPromotionSummary;
}

export async function uploadTrainingDatasetWeights(
  folderPrefix: string,
  file: File,
  userEmail?: string | null,
): Promise<UploadTrainingWeightsResponse> {
  const fd = new FormData();
  fd.set('folderPrefix', folderPrefix);
  fd.set('file', file, file.name);
  const headers: Record<string, string> = {};
  if (userEmail && String(userEmail).trim()) {
    headers['x-user-email'] = String(userEmail).trim();
  }
  const response = await fetch(`${API_BASE_URL}/training-datasets/weights`, {
    method: 'POST',
    headers,
    body: fd,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<UploadTrainingWeightsResponse>(text, response.status);
}

export interface TrainingWeightsSignedUrlResponse {
  url: string;
  expiresInSeconds: number;
  bucket: string;
  key: string;
}

export async function fetchTrainingWeightsSignedUrl(
  folderPrefix: string,
): Promise<TrainingWeightsSignedUrlResponse> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const response = await fetch(`${API_BASE_URL}/training-datasets/weights-signed-url?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingWeightsSignedUrlResponse>(text, response.status);
}

export async function downloadTrainingDatasetZip(folderPrefix: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const res = await fetch(`${API_BASE_URL}/export/training-dataset-zip?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(text) as { error?: string };
      if (err?.error) msg = err.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `training-dataset-${Date.now()}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface TrainingDatasetsResponse {
  bucket: string;
  rootPrefix: string;
  trainingDatasetsSegment: string;
  datasets: TrainingDatasetRow[];
}

export async function fetchTrainingDatasets(): Promise<TrainingDatasetsResponse> {
  const response = await fetch(`${API_BASE_URL}/training-datasets`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingDatasetsResponse>(text, response.status);
}

export interface CreateTrainingDatasetResponse {
  schemaVersion: number;
  displayName: string;
  createdAt: string;
  folderPrefix: string;
  slug: string;
  timestamp: number;
  note?: string;
  key: string;
  bucket: string;
}

export async function createTrainingDataset(name: string): Promise<CreateTrainingDatasetResponse> {
  const response = await fetch(`${API_BASE_URL}/training-datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<CreateTrainingDatasetResponse>(text, response.status);
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
