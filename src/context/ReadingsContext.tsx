import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ReadingStatus, DashboardCounts } from '../types';
import { fetchReadings, bulkMoveReadings, type S3MeterReading } from '../services/api';
import { mockReadings, calculateCounts } from '../data/mockData';

export type DataSource = 'all' | 'field' | 'simulator';

interface ReadingsContextType {
  readings: S3MeterReading[];
  filteredReadings: S3MeterReading[];
  counts: DashboardCounts;
  loading: boolean;
  error: string | null;
  isUsingRealData: boolean;
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  updateReadingStatus: (id: string, status: ReadingStatus) => void;
  updateReadingComments: (id: string, comments: string) => void;
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => Promise<void>;
  getReadingsByStatus: (status: ReadingStatus | 'all') => S3MeterReading[];
  getReadingById: (id: string) => S3MeterReading | undefined;
  refreshData: () => Promise<void>;
}

const ReadingsContext = createContext<ReadingsContextType | undefined>(undefined);

export const ReadingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [allReadings, setAllReadings] = useState<S3MeterReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingRealData, setIsUsingRealData] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>('all');

  const loadData = useCallback(async (source?: DataSource) => {
    setLoading(true);
    setError(null);

    try {
      // Try to fetch from API with optional source filter
      const apiReadings = await fetchReadings(source);
      
      setAllReadings(apiReadings);
      setIsUsingRealData(true);
      console.log(`✅ Loaded ${apiReadings.length} readings from S3 (source: ${source || 'all'})`);
    } catch (err) {
      console.warn('⚠️ Failed to load from API, using mock data:', err);
      // Fall back to mock data
      setAllReadings(mockReadings as S3MeterReading[]);
      setIsUsingRealData(false);
      setError('Using mock data - API server not running');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(dataSource);
  }, [loadData, dataSource]);

  // Filter readings based on data source
  const filteredReadings = useMemo(() => {
    if (dataSource === 'all') return allReadings;
    return allReadings.filter(r => r.type === dataSource);
  }, [allReadings, dataSource]);

  // Calculate counts from filtered readings
  const counts = useMemo((): DashboardCounts => {
    const readings = filteredReadings;
    return {
      totalPictures: readings.reduce((sum, r) => sum + r.images.length, 0),
      correctCount: readings.filter(r => r.status === 'correct').length,
      incorrectNewCount: readings.filter(r => r.status === 'incorrect_new').length,
      incorrectAnalyzedCount: readings.filter(r => r.status === 'incorrect_analyzed').length,
      incorrectLabeledCount: readings.filter(r => r.status === 'incorrect_labeled').length,
      incorrectTrainingCount: readings.filter(r => r.status === 'incorrect_training').length,
    };
  }, [filteredReadings]);

  const refreshData = useCallback(async () => {
    await loadData(dataSource);
  }, [loadData, dataSource]);

  const updateReadingStatus = useCallback((id: string, status: ReadingStatus) => {
    setAllReadings(prev => prev.map(reading => 
      reading.id === id 
        ? { ...reading, status, updatedAt: new Date().toISOString() }
        : reading
    ));
  }, []);

  const updateReadingComments = useCallback((id: string, comments: string) => {
    setAllReadings(prev => prev.map(reading => 
      reading.id === id 
        ? { ...reading, comments, updatedAt: new Date().toISOString() }
        : reading
    ));
  }, []);

  const bulkUpdateStatus = useCallback(async (ids: string[], status: ReadingStatus) => {
    // Get the readings to find their current info
    const readingsToUpdate = allReadings.filter(r => ids.includes(r.id));
    
    if (readingsToUpdate.length === 0) return;

    try {
      // Call API to move files in S3
      await bulkMoveReadings(readingsToUpdate.map(r => ({
        sessionId: r.id,
        sourceType: r.type,
        currentStatus: r.status,
        targetStatus: status,
      })));

      // Update local state
      setAllReadings(prev => prev.map(reading => 
        ids.includes(reading.id)
          ? { ...reading, status, updatedAt: new Date().toISOString() }
          : reading
      ));

      console.log(`✅ Moved ${ids.length} readings to ${status}`);
    } catch (error) {
      console.error('Failed to bulk update:', error);
      throw error;
    }
  }, [allReadings]);

  const getReadingsByStatus = useCallback((status: ReadingStatus | 'all') => {
    if (status === 'all') return filteredReadings;
    return filteredReadings.filter(r => r.status === status);
  }, [filteredReadings]);

  const getReadingById = useCallback((id: string) => {
    return allReadings.find(r => r.id === id);
  }, [allReadings]);

  return (
    <ReadingsContext.Provider value={{
      readings: allReadings,
      filteredReadings,
      counts,
      loading,
      error,
      isUsingRealData,
      dataSource,
      setDataSource,
      updateReadingStatus,
      updateReadingComments,
      bulkUpdateStatus,
      getReadingsByStatus,
      getReadingById,
      refreshData,
    }}>
      {children}
    </ReadingsContext.Provider>
  );
};

export const useReadings = () => {
  const context = useContext(ReadingsContext);
  if (!context) {
    throw new Error('useReadings must be used within a ReadingsProvider');
  }
  return context;
};
