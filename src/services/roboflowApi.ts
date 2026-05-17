const API = '/api/roboflow';

export interface RoboflowStatus {
  configured: boolean;
  workspace: string | null;
  error?: string;
}

export interface RoboflowProject {
  name: string;
  slug: string;
  datasetSlug: string;
  type: string | null;
  url: string | null;
  annotateUrl: string | null;
}

export async function fetchRoboflowStatus(): Promise<RoboflowStatus> {
  const res = await fetch(`${API}/status`);
  if (!res.ok) {
    return { configured: false, workspace: null, error: `HTTP ${res.status}` };
  }
  return res.json();
}

export async function fetchRoboflowProjects(): Promise<{
  workspace: string;
  projects: RoboflowProject[];
}> {
  const res = await fetch(`${API}/projects`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface RoboflowProjectVersion {
  version: number | null;
  name: string | null;
  created: string | null;
  trainImages: number | null;
  map: number | null;
  precision?: number | null;
  recall?: number | null;
  hasTrainedModel?: boolean;
  /** Roboflow model id, e.g. sempra_keypoint_model/10 */
  modelId?: string | null;
  modelUpdated?: string | number | null;
}

export interface RoboflowProjectDetail {
  workspace: string;
  projectSlug: string;
  datasetSlug: string;
  name: string;
  type: string | null;
  imageCounts: {
    total: number | null;
    train: number | null;
    valid: number | null;
    test: number | null;
  };
  versions: RoboflowProjectVersion[];
  /** Subset of versions that have a trained model (Roboflow Models tab). */
  trainedModels: RoboflowProjectVersion[];
  versionCount?: number;
  modelsUrl?: string;
  annotateUrl: string;
  url: string;
}

export async function fetchRoboflowProjectDetail(datasetSlug: string): Promise<RoboflowProjectDetail> {
  const q = new URLSearchParams({ dataset: datasetSlug });
  const res = await fetch(`${API}/project?${q}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface RoboflowVersionDetail {
  datasetSlug: string;
  version: number;
  versionName: string | null;
  modelType: string | null;
  modelTypeDisplay: string | null;
  trainStatus: string | null;
  exports: string[];
  hasTrainedModel: boolean;
  imageCount: number | null;
  splits: { train: number | null; valid: number | null; test: number | null };
  versionCreatedAt: string | null;
  lastTrainedAt: string | null;
  mapPercent: number | null;
  precisionPercent: number | null;
  recallPercent: number | null;
  checkpoint: string | null;
  modelEndpoint: string | null;
  modelId: string | null;
}

/** @deprecated use RoboflowVersionDetail */
export type RoboflowVersionTrainMeta = Pick<
  RoboflowVersionDetail,
  'datasetSlug' | 'version' | 'modelType' | 'modelTypeDisplay' | 'trainStatus' | 'exports' | 'hasTrainedModel'
>;

export async function fetchRoboflowVersionMeta(
  datasetSlug: string,
  version: number,
): Promise<RoboflowVersionDetail> {
  const q = new URLSearchParams({ dataset: datasetSlug, version: String(version) });
  const res = await fetch(`${API}/version?${q}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Guess Roboflow role from project type or name. */
export function inferRoboflowProjectRole(
  project: RoboflowProject | { type?: string | null; name?: string; slug?: string },
): 'dial_detection' | 'keypoint' | null {
  const type = (project.type || '').toLowerCase();
  const name = `${project.name || ''} ${project.slug || ''}`.toLowerCase();
  if (type.includes('keypoint') || type.includes('pose') || name.includes('keypoint') || name.includes('pose')) {
    return 'keypoint';
  }
  if (
    type.includes('object') ||
    type.includes('detection') ||
    name.includes('dial') ||
    name.includes('detect')
  ) {
    return 'dial_detection';
  }
  return null;
}

export interface UploadSessionPayload {
  sessionId: string;
  dataset: string;
  workType?: string;
  split?: 'train' | 'valid' | 'test';
  batch?: string;
  imageScope?: 'original' | 'all';
}

export interface UploadSessionResult {
  success: boolean;
  uploaded: number;
  failed: number;
  batch: string;
  annotateUrl: string;
  results: Array<{ key: string; ok: boolean; error?: string; roboflow?: unknown }>;
}

export async function uploadSessionToRoboflow(payload: UploadSessionPayload): Promise<UploadSessionResult> {
  const res = await fetch(`${API}/upload-from-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as UploadSessionResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as UploadSessionResult;
}
