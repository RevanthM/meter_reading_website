import type { MeterReading, DashboardCounts, WorkType } from '../types';
import type { DataSource } from '../context/ReadingsContext';

const API_BASE_URL = '/api';

export interface S3MeterReading extends MeterReading {
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
  workType?: WorkType;
  conditionCode?: string;
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

export async function fetchReadingById(id: string): Promise<S3MeterReading | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/readings/${encodeURIComponent(id)}`);
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
}

export async function bulkMoveReadings(readings: BulkMoveRequest[]): Promise<{ success: boolean; moved: number }> {
  try {
    const response = await fetch(`${API_BASE_URL}/readings/bulk-move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
