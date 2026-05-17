import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ReadingStatus, DashboardCounts, WorkType, ReadingsListFilter } from '../types';
import { isIncorrectPipelineStatus } from '../types';
import { fetchReadings, fetchCounts, bulkMoveReadings, type S3MeterReading } from '../services/api';
import { mockReadings } from '../data/mockData';
import { calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';
import { useAuth } from './AuthContext';

export type DataSource = 'all' | 'field' | 'simulator';

interface ReadingsContextType {
  readings: S3MeterReading[];
  filteredReadings: S3MeterReading[];
  counts: DashboardCounts;
  countsLoading: boolean;
  readingsLoading: boolean;
  loading: boolean;
  error: string | null;
  isUsingRealData: boolean;
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  workType: WorkType;
  setWorkType: (workType: WorkType) => void;
  /** Load full readings on demand (readings list, training hub, edit modal). Skipped on dashboard/factory mount. */
  ensureReadingsLoaded: () => Promise<void>;
  updateReadingStatus: (id: string, status: ReadingStatus, snapshot?: S3MeterReading) => Promise<void>;
  updateReadingComments: (id: string, comments: string) => void;
  bulkUpdateStatus: (ids: string[], status: ReadingStatus) => Promise<void>;
  getReadingsByStatus: (status: ReadingsListFilter) => S3MeterReading[];
  getReadingById: (id: string) => S3MeterReading | undefined;
  refreshData: () => Promise<void>;
  /** Folder counts only (fast) — used by dashboard refresh without loading all sessions. */
  refreshCounts: () => Promise<void>;
}

const ReadingsContext = createContext<ReadingsContextType | undefined>(undefined);

export const ReadingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, anicaLoginUser, isAuthorized, userEmail } = useAuth();
  const [allReadings, setAllReadings] = useState<S3MeterReading[]>([]);
  const [serverCounts, setServerCounts] = useState<DashboardCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [readingsLoading, setReadingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUsingRealData, setIsUsingRealData] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>('all');
  const [workType, setWorkType] = useState<WorkType>('1000');
  const readingsLoadStarted = useRef(false);
  const readingsLoadPromise = useRef<Promise<void> | null>(null);

  const loadCounts = useCallback(async (source?: DataSource, wt?: WorkType) => {
    setCountsLoading(true);
    setError(null);
    try {
      const counts = await fetchCounts(source, wt);
      setServerCounts(counts);
      setIsUsingRealData(true);
    } catch (err) {
      console.warn('⚠️ Failed to load counts from API:', err);
      setServerCounts(null);
    } finally {
      setCountsLoading(false);
    }
  }, []);

  const loadReadings = useCallback(async (source?: DataSource, wt?: WorkType, refresh = false) => {
    setReadingsLoading(true);
    try {
      const apiReadings = await fetchReadings(source, wt, refresh);
      setAllReadings(apiReadings);
      console.log(`✅ Loaded ${apiReadings.length} readings from S3 (source: ${source || 'all'}, workType: ${wt || '1000'})`);
    } catch (err) {
      console.warn('⚠️ Failed to load readings from API, using mock data:', err);
      setAllReadings(mockReadings as S3MeterReading[]);
      setIsUsingRealData(false);
      setError('Using mock data - API server not running');
    } finally {
      setReadingsLoading(false);
    }
  }, []);

  const ensureReadingsLoaded = useCallback(async () => {
    if (readingsLoadPromise.current) {
      await readingsLoadPromise.current;
      return;
    }
    if (readingsLoadStarted.current && allReadings.length > 0 && !readingsLoading) {
      return;
    }
    readingsLoadStarted.current = true;
    const p = loadReadings(dataSource, workType);
    readingsLoadPromise.current = p;
    try {
      await p;
    } finally {
      readingsLoadPromise.current = null;
    }
  }, [allReadings.length, dataSource, loadReadings, readingsLoading, workType]);

  const refreshCounts = useCallback(async () => {
    await loadCounts(dataSource, workType);
  }, [dataSource, loadCounts, workType]);

  const refreshData = useCallback(async () => {
    readingsLoadStarted.current = true;
    await Promise.all([loadCounts(dataSource, workType), loadReadings(dataSource, workType, true)]);
  }, [dataSource, loadCounts, loadReadings, workType]);

  useEffect(() => {
    if ((user || anicaLoginUser) && isAuthorized) {
      readingsLoadStarted.current = false;
      readingsLoadPromise.current = null;
      setAllReadings([]);
      void loadCounts(dataSource, workType);
    }
  }, [loadCounts, dataSource, workType, user, anicaLoginUser, isAuthorized]);

  const filteredReadings = useMemo(() => {
    if (dataSource === 'all') return allReadings;
    return allReadings.filter((r) => r.type === dataSource);
  }, [allReadings, dataSource]);

  const counts = useMemo((): DashboardCounts => {
    const todayIso = calendarDayKeyInPortalTz(new Date().toISOString());
    const uploadedTodayFromReadings = filteredReadings.filter(
      (r) => calendarDayKeyInPortalTz(r.dateOfReading) === todayIso,
    ).length;

    if (serverCounts) {
      return {
        ...serverCounts,
        uploadedTodayCount: uploadedTodayFromReadings,
      };
    }
    const readings = filteredReadings;
    return {
      totalPictures: readings.length,
      correctCount: readings.filter((r) => r.status === 'correct').length,
      incorrectNewCount: readings.filter((r) => r.status === 'incorrect_new').length,
      incorrectAnalyzedCount: readings.filter((r) => r.status === 'incorrect_analyzed').length,
      incorrectLabeledCount: readings.filter((r) => r.status === 'incorrect_labeled').length,
      incorrectTrainingCount: readings.filter((r) => r.status === 'incorrect_training').length,
      noDialsCount: readings.filter((r) => r.status === 'no_dials').length,
      notSureCount: readings.filter((r) => r.status === 'not_sure').length,
      uploadedTodayCount: uploadedTodayFromReadings,
    };
  }, [filteredReadings, serverCounts]);

  const updateReadingStatus = useCallback(
    async (id: string, status: ReadingStatus, snapshot?: S3MeterReading) => {
      const reading = snapshot ?? allReadings.find((r) => r.id === id);
      if (!reading) return;

      if (reading.status === status) {
        return;
      }

      try {
        await bulkMoveReadings(
          [
            {
              sessionId: reading.id,
              sourceType: reading.type,
              currentStatus: reading.status,
              targetStatus: status,
              ...(reading.s3SessionPrefix ? { s3SessionPrefix: reading.s3SessionPrefix } : {}),
            },
          ],
          userEmail || undefined,
        );

        setAllReadings((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status, updatedAt: new Date().toISOString() } : r)),
        );

        console.log(`✅ Moved reading ${id} from ${reading.status} to ${status}`);
      } catch (error) {
        console.error('Failed to update status:', error);
        throw error;
      }
    },
    [allReadings, userEmail],
  );

  const updateReadingComments = useCallback((id: string, comments: string) => {
    setAllReadings((prev) =>
      prev.map((reading) =>
        reading.id === id ? { ...reading, comments, updatedAt: new Date().toISOString() } : reading,
      ),
    );
  }, []);

  const bulkUpdateStatus = useCallback(
    async (ids: string[], status: ReadingStatus) => {
      const readingsToUpdate = allReadings.filter((r) => ids.includes(r.id));

      if (readingsToUpdate.length === 0) return;

      try {
        await bulkMoveReadings(
          readingsToUpdate.map((r) => ({
            sessionId: r.id,
            sourceType: r.type,
            currentStatus: r.status,
            targetStatus: status,
            ...(r.s3SessionPrefix ? { s3SessionPrefix: r.s3SessionPrefix } : {}),
          })),
          userEmail || undefined,
        );

        setAllReadings((prev) =>
          prev.map((reading) =>
            ids.includes(reading.id) ? { ...reading, status, updatedAt: new Date().toISOString() } : reading,
          ),
        );

        console.log(`✅ Moved ${ids.length} readings to ${status}`);
      } catch (error) {
        console.error('Failed to bulk update:', error);
        throw error;
      }
    },
    [allReadings, userEmail],
  );

  const getReadingsByStatus = useCallback(
    (status: ReadingsListFilter) => {
      if (status === 'all') return filteredReadings;
      if (status === 'incorrect-queues') {
        return filteredReadings.filter((r) => isIncorrectPipelineStatus(r.status));
      }
      return filteredReadings.filter((r) => r.status === status);
    },
    [filteredReadings],
  );

  const getReadingById = useCallback(
    (id: string) => {
      return allReadings.find((r) => r.id === id);
    },
    [allReadings],
  );

  const loading = countsLoading || readingsLoading;

  return (
    <ReadingsContext.Provider
      value={{
        readings: allReadings,
        filteredReadings,
        counts,
        countsLoading,
        readingsLoading,
        loading,
        error,
        isUsingRealData,
        dataSource,
        setDataSource,
        workType,
        setWorkType,
        ensureReadingsLoaded,
        updateReadingStatus,
        updateReadingComments,
        bulkUpdateStatus,
        getReadingsByStatus,
        getReadingById,
        refreshData,
        refreshCounts,
      }}
    >
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
