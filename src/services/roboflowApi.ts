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
