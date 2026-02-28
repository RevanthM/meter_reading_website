import { WorkType, WorkTypeStats, ImageListResponse, ImageRecord } from '../types';

const API_BASE = '/api';

export async function fetchWorkTypes(): Promise<WorkType[]> {
  const response = await fetch(`${API_BASE}/work-types`);
  if (!response.ok) {
    throw new Error('Failed to fetch work types');
  }
  return response.json();
}

export async function fetchAllWorkTypeStats(): Promise<WorkTypeStats[]> {
  const response = await fetch(`${API_BASE}/work-types/stats`);
  if (!response.ok) {
    throw new Error('Failed to fetch work type stats');
  }
  return response.json();
}

export async function fetchWorkTypeStats(workTypeCode: string): Promise<WorkTypeStats> {
  const response = await fetch(`${API_BASE}/work-types/${workTypeCode}/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats for work type: ${workTypeCode}`);
  }
  return response.json();
}

export async function fetchImagesByWorkType(
  workTypeCode: string,
  limit: number = 50,
  nextToken?: string,
  usePresigned: boolean = false
): Promise<ImageListResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    use_presigned: usePresigned.toString(),
  });
  if (nextToken) {
    params.set('next_token', nextToken);
  }
  
  const response = await fetch(
    `${API_BASE}/images/by-work-type/${workTypeCode}?${params}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch images for work type: ${workTypeCode}`);
  }
  return response.json();
}

export async function fetchImage(sessionId: string, usePresigned: boolean = false): Promise<ImageRecord> {
  const params = new URLSearchParams({
    use_presigned: usePresigned.toString(),
  });
  
  const response = await fetch(`${API_BASE}/images/${sessionId}?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${sessionId}`);
  }
  return response.json();
}

export async function updateImageStatus(sessionId: string, status: string): Promise<void> {
  const response = await fetch(`${API_BASE}/images/${sessionId}/status?status=${status}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`Failed to update image status: ${sessionId}`);
  }
}
