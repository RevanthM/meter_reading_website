import type { MeterReading, DashboardCounts } from '../types';
import type { DataSource } from '../context/ReadingsContext';

const API_BASE_URL = 'http://localhost:3001/api';

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
  bucket?: string; // Which bucket this came from
}

export async function fetchReadings(source?: DataSource): Promise<S3MeterReading[]> {
  try {
    const url = source && source !== 'all' 
      ? `${API_BASE_URL}/readings?source=${source}`
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

export async function fetchCounts(source?: DataSource): Promise<DashboardCounts> {
  try {
    const url = source && source !== 'all'
      ? `${API_BASE_URL}/counts?source=${source}`
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
