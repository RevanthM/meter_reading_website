import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ReadingStatus, DashboardCounts, WorkType } from '../types';
import { fetchReadings, fetchCounts, bulkMoveReadings, type S3MeterReading } from '../services/api';
import { mockReadings } from '../data/mockData';
import { useAuth } from './AuthContext';

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
  workType: WorkType;
  setWorkType: (workType: WorkType) => void;
  updateReadingStatus: (id: string, status: ReadingStatus) => Promise<void>;
  updateReadingComments: (id: string, comments: string) => void;
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => Promise<void>;
  getReadingsByStatus: (status: ReadingStatus | 'all') => S3MeterReading[];
  getReadingById: (id: string) => S3MeterReading | undefined;
  refreshData: () => Promise<void>;
}

const ReadingsContext = createContext<ReadingsContextType | undefined>(undefined);

export const ReadingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, isAuthorized, userEmail } = useAuth();
  const [allReadings, setAllReadings] = useState<S3MeterReading[]>([]);
  const [serverCounts, setServerCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUsingRealData, setIsUsingRealData] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>('all');
  const [workType, setWorkType] = useState<WorkType>('1000');
  const [hasLoadedReadings, setHasLoadedReadings] = useState(false);

  // Load lightweight counts first (fast), then full readings in background
  const loadData = useCallback(async (source?: DataSource, wt?: WorkType) => {
    setLoading(true);
    setError(null);

    try {
      // Fetch counts first (lightweight, fast)
      const countsPromise = fetchCounts(source, wt);
      // Fetch full readings in parallel
      const readingsPromise = fetchReadings(source, wt);

      const counts = await countsPromise;
      setServerCounts(counts);
      setIsUsingRealData(true);

      const apiReadings = await readingsPromise;
      setAllReadings(apiReadings);
      setHasLoadedReadings(true);
      console.log(`✅ Loaded ${apiReadings.length} readings from S3 (source: ${source || 'all'}, workType: ${wt || '1000'})`);
    } catch (err) {
      console.warn('⚠️ Failed to load from API, using mock data:', err);
      setAllReadings(mockReadings as S3MeterReading[]);
      setIsUsingRealData(false);
      setError('Using mock data - API server not running');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only load data when user is authenticated
  useEffect(() => {
    if (user && isAuthorized) {
      loadData(dataSource, workType);
    }
  }, [loadData, dataSource, workType, user, isAuthorized]);

  // Filter readings based on data source
  const filteredReadings = useMemo(() => {
    if (dataSource === 'all') return allReadings;
    return allReadings.filter(r => r.type === dataSource);
  }, [allReadings, dataSource]);

  // Use server counts if available (faster), otherwise compute from loaded readings
  const counts = useMemo((): DashboardCounts => {
    if (serverCounts && !hasLoadedReadings) {
      return serverCounts;
    }
    const readings = filteredReadings;
    return {
      totalPictures: readings.length,
      correctCount: readings.filter(r => r.status === 'correct').length,
      incorrectNewCount: readings.filter(r => r.status === 'incorrect_new').length,
      incorrectAnalyzedCount: readings.filter(r => r.status === 'incorrect_analyzed').length,
      incorrectLabeledCount: readings.filter(r => r.status === 'incorrect_labeled').length,
      incorrectTrainingCount: readings.filter(r => r.status === 'incorrect_training').length,
      noDialsCount: readings.filter(r => r.status === 'no_dials').length,
      notSureCount: readings.filter(r => r.status === 'not_sure').length,
    };
  }, [filteredReadings, serverCounts, hasLoadedReadings]);

  const refreshData = useCallback(async () => {
    await loadData(dataSource, workType);
  }, [loadData, dataSource, workType]);

  const updateReadingStatus = useCallback(async (id: string, status: ReadingStatus) => {
    // Find the reading to get current status and type
    const reading = allReadings.find(r => r.id === id);
    if (!reading) return;

    // If status hasn't changed, just update locally
    if (reading.status === status) {
      return;
    }

    try {
      // Call API to move files in S3
      await bulkMoveReadings([{
        sessionId: reading.id,
        sourceType: reading.type,
        currentStatus: reading.status,
        targetStatus: status,
      }], userEmail || undefined);

      // Update local state after successful S3 move
      setAllReadings(prev => prev.map(r => 
        r.id === id 
          ? { ...r, status, updatedAt: new Date().toISOString() }
          : r
      ));

      console.log(`✅ Moved reading ${id} from ${reading.status} to ${status}`);
    } catch (error) {
      console.error('Failed to update status:', error);
      throw error;
    }
  }, [allReadings, userEmail]);

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
      })), userEmail || undefined);

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
  }, [allReadings, userEmail]);

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
      workType,
      setWorkType,
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
