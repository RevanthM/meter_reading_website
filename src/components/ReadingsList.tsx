import { useState, useMemo, useCallback, useEffect, type CSSProperties, type FC } from 'react';
import { useParams, useNavigate, useSearchParams, useOutletContext, useLocation } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import type { ReadingStatus, ReadingsListFilter } from '../types';
import {
  statusLabels,
  statusColors,
  INCORRECT_PIPELINE_STATUSES,
  labelerPipelineStatusLabels,
  getReadingListStatusDisplay,
  isAwaitingReviewerReview,
} from '../types';
import {
  ArrowLeft,
  Eye,
  MapPin,
  Calendar,
  Monitor,
  Radio,
  Gauge,
  CheckSquare,
  Square,
  ArrowRightCircle,
  Loader2,
  X,
  Download,
  FolderInput,
  User,
  SlidersHorizontal,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import {
  downloadListRetrainZip,
  fetchTrainingDatasets,
  copySessionsToTrainingDataset,
  type ListExportDateOpts,
  type CopySessionsToTrainingDatasetResult,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { folderPrefixToSegment } from '../utils/trainingPipeline';
import type { S3MeterReading } from '../services/api';
import {
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from '../utils/dateRangePresets';
import { calendarDayKeyInPortalTz, formatReadingShortDate } from '../utils/readingDisplayDates';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import CaptureViewModeToggle from './CaptureViewModeToggle';
import { CaptureMapViewKeepAlive } from './CaptureMapView';
import { useCaptureViewMode } from '../hooks/useCaptureViewMode';
import { captureLocationListLine } from '../utils/captureLocation';

/** When browsing all statuses, surface awaiting-review (incorrect_new) first, then pipeline order, then correct. */
const LIST_PRIORITY: Record<string, number> = {
  manually_uploaded: -1,
  incorrect_new: 0,
  incorrect_analyzed: 1,
  incorrect_labeled: 2,
  incorrect_training: 3,
  not_sure: 4,
  no_dials: 5,
  correct: 6,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** List toolbar cohort (replaces pipeline-stage dropdown + legacy trainingPick). */
const READINGS_COHORT_IDS = ['untrained', 'correct', 'incorrect', 'training', 'test_data'] as const;
type ReadingsCohortId = (typeof READINGS_COHORT_IDS)[number];

function isReadingsCohortId(s: string): s is ReadingsCohortId {
  return (READINGS_COHORT_IDS as readonly string[]).includes(s);
}

/** Legacy URLs used cohort=recommended; map to training. */
function normalizeReadingsCohortId(s: string): ReadingsCohortId | null {
  const lower = s.trim().toLowerCase();
  if (lower === 'recommended') return 'training';
  if (lower === 'wrong') return 'incorrect';
  return isReadingsCohortId(lower) ? lower : null;
}

const READINGS_COHORT_LABELS: Record<ReadingsCohortId, string> = {
  untrained: 'Untrained',
  correct: 'Reviewed correct',
  incorrect: 'Reviewed incorrect',
  training: 'Send to training',
  test_data: 'Send to test dataset',
};

/** Reviewed-outcome cohorts must not intersect the awaiting-review route pool (unreviewed only). */
function cohortUsesGlobalReadingsPool(cohort: ReadingsCohortId): boolean {
  return cohort !== 'untrained';
}

function matchesReadingsCohort(r: S3MeterReading, cohort: ReadingsCohortId): boolean {
  switch (cohort) {
    case 'untrained':
      return isAwaitingReviewerReview(r);
    case 'correct':
      return r.status === 'correct';
    case 'incorrect':
      return (
        r.status === 'incorrect_analyzed' ||
        r.status === 'incorrect_labeled' ||
        r.status === 'incorrect_training' ||
        (r.status === 'incorrect_new' && r.isManuallyReviewed === true)
      );
    case 'training':
      return (
        r.status !== 'incorrect_training' &&
        (r.reviewerDatasetDestination === 'training' || r.reviewerRecommendTraining === true)
      );
    case 'test_data':
      return r.reviewerDatasetDestination === 'test';
  }
}

function normalizeReadingAppVersion(r: S3MeterReading): string {
  const raw =
    r.appVersion != null && String(r.appVersion).trim() !== ''
      ? String(r.appVersion).trim()
      : 'unknown';
  return raw;
}

/** Coerce metadata confidence (number, numeric string, or 0–100 percentage) to 0–1. */
function normalizeConfidenceScalar(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1 && raw <= 100) return raw / 100;
    if (raw >= 0 && raw <= 1) return raw;
    return undefined;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return undefined;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return undefined;
    if (n > 1 && n <= 100) return n / 100;
    if (n >= 0 && n <= 1) return n;
    return undefined;
  }
  return undefined;
}

/**
 * One scalar for sorting: session-level confidence when present, else minimum dial confidence.
 * Missing values → +∞ so ascending (lowest first) keeps them at the bottom.
 */
function effectiveConfidenceForSort(r: S3MeterReading): number {
  const top = normalizeConfidenceScalar(r.confidence);
  if (top !== undefined) return top;
  const dials = r.dialDetails;
  if (Array.isArray(dials) && dials.length > 0) {
    const nested = dials
      .map((d) => normalizeConfidenceScalar(d.confidence))
      .filter((n): n is number => n !== undefined);
    if (nested.length > 0) return Math.min(...nested);
  }
  return Number.POSITIVE_INFINITY;
}

function effectiveConfidenceForDisplay(r: S3MeterReading): number | undefined {
  const top = normalizeConfidenceScalar(r.confidence);
  if (top !== undefined) return top;
  const dials = r.dialDetails;
  if (Array.isArray(dials) && dials.length > 0) {
    const nested = dials
      .map((d) => normalizeConfidenceScalar(d.confidence))
      .filter((n): n is number => n !== undefined);
    if (nested.length > 0) return Math.min(...nested);
  }
  return undefined;
}

type ListSortColumn = 'date' | 'confidence';
type ListSortDir = 'asc' | 'desc';

function readingDateSortKey(r: S3MeterReading): string {
  return (
    calendarDayKeyInPortalTz(r.dateOfReading || '') ||
    calendarDayKeyInPortalTz(r.createdAt || '') ||
    ''
  );
}

function sortReadingsForList(
  readings: S3MeterReading[],
  listStatus: string | undefined,
  listSort: ListSortColumn,
  listSortDir: ListSortDir,
): S3MeterReading[] {
  const dateCmp = (a: S3MeterReading, b: S3MeterReading) => {
    const da = readingDateSortKey(a);
    const db = readingDateSortKey(b);
    if (da !== db) return da.localeCompare(db);
    return (a.id || '').localeCompare(b.id || '');
  };
  const confCmp = (a: S3MeterReading, b: S3MeterReading) => {
    const ca = effectiveConfidenceForSort(a);
    const cb = effectiveConfidenceForSort(b);
    if (ca !== cb) return ca - cb;
    return dateCmp(a, b);
  };

  const primaryCmp = listSort === 'confidence' ? confCmp : dateCmp;
  const sorted = (cmp: (a: S3MeterReading, b: S3MeterReading) => number) => {
    const out = [...readings].sort(cmp);
    return listSortDir === 'desc' ? out.reverse() : out;
  };

  if (listStatus !== 'all') {
    return sorted(primaryCmp);
  }
  return sorted((a, b) => {
    const pa = LIST_PRIORITY[a.status] ?? 99;
    const pb = LIST_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return primaryCmp(a, b);
  });
}

const ReadingsList: FC = () => {
  const { status } = useParams<{ status: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getReadingsByStatus,
    bulkUpdateStatus,
    workType,
    dataSource,
    setDataSource,
    isUsingRealData,
    ensureReadingsLoaded,
    refreshData,
    readingsLoading,
  } = useReadings();

  const [listRefreshing, setListRefreshing] = useState(false);

  const handleListRefresh = useCallback(async () => {
    setListRefreshing(true);
    try {
      await refreshData();
    } finally {
      setListRefreshing(false);
    }
  }, [refreshData]);

  useEffect(() => {
    void ensureReadingsLoaded();
  }, [ensureReadingsLoaded]);
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const showBulkMove = portalWorkMode !== 'labeler';
  const showTrainingCopy = portalWorkMode !== 'reviewer';
  const [zipExporting, setZipExporting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<ReadingStatus>('incorrect_analyzed');
  const [isMoving, setIsMoving] = useState(false);

  const [trainingFolders, setTrainingFolders] = useState<{ folderPrefix: string; label: string }[]>([]);
  const [trainingFoldersLoading, setTrainingFoldersLoading] = useState(false);
  const [trainingFolderPrefix, setTrainingFolderPrefix] = useState('');
  const [copyingToTraining, setCopyingToTraining] = useState(false);
  const [copyToTrainingProgress, setCopyToTrainingProgress] = useState<{ done: number; total: number } | null>(null);
  const [trainingCopyMessage, setTrainingCopyMessage] = useState<string | null>(null);

  const pipelineSeg = (searchParams.get('pipeline') || '').trim();
  const dateFilter = (searchParams.get('date') || '').trim();
  const fromFilter = (searchParams.get('from') || '').trim();
  const toFilter = (searchParams.get('to') || '').trim();
  const appVersionParam = useMemo(() => {
    const raw = searchParams.get('appVersion');
    if (raw == null) return '';
    const t = raw.trim();
    if (!t) return '';
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }, [searchParams]);

  const rangePresetRaw = (searchParams.get('range') || '').trim();
  const rangePreset: DateRangePresetId | '' = isDateRangePresetId(rangePresetRaw) ? rangePresetRaw : '';
  const presetWindow = rangePreset ? getDateRangeFromPreset(rangePreset) : null;

  const capturedParam = useMemo(() => (searchParams.get('captured') || '').trim(), [searchParams]);

  const cohortParamRaw = (searchParams.get('cohort') || '').trim().toLowerCase();
  const cohortFromUrl = normalizeReadingsCohortId(cohortParamRaw);
  /** Legacy `?trainingPick=1` → training cohort. */
  const trainingPickLegacy = searchParams.get('trainingPick') === '1';
  const activeCohort: ReadingsCohortId | null = cohortFromUrl ?? (trainingPickLegacy ? 'training' : null);

  const listStatusKey = (status ?? 'all') as ReadingsListFilter;

  const sortParamRaw = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return (p.get('sort') || '').trim().toLowerCase();
  }, [location.search]);
  const sortDirParamRaw = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return (p.get('dir') || '').trim().toLowerCase();
  }, [location.search]);

  const effectiveListSort = useMemo((): ListSortColumn => {
    if (sortParamRaw === 'confidence') return 'confidence';
    return 'date';
  }, [sortParamRaw]);

  const effectiveListSortDir = useMemo((): ListSortDir => {
    if (sortDirParamRaw === 'asc' || sortDirParamRaw === 'desc') return sortDirParamRaw;
    return effectiveListSort === 'date' ? 'desc' : 'asc';
  }, [sortDirParamRaw, effectiveListSort]);

  const toggleListSort = useCallback(
    (column: ListSortColumn) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          const currentCol =
            (n.get('sort') || '').trim().toLowerCase() === 'confidence' ? 'confidence' : 'date';
          const currentDir = n.get('dir') === 'asc' ? 'asc' : n.get('dir') === 'desc' ? 'desc' : null;
          if (currentCol === column && currentDir) {
            n.set('sort', column);
            n.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
          } else {
            n.set('sort', column);
            n.set('dir', column === 'date' ? 'desc' : 'asc');
          }
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [capturedDraft, setCapturedDraft] = useState(capturedParam);
  useEffect(() => {
    setCapturedDraft(capturedParam);
  }, [capturedParam]);

  const viewModeStorageKey = `portal.readingsList.viewMode.${dataSource}`;
  const [viewMode, setViewMode] = useCaptureViewMode(viewModeStorageKey);

  const readings = useMemo(() => {
    const filterKey = listStatusKey;
    const base = getReadingsByStatus(
      activeCohort && cohortUsesGlobalReadingsPool(activeCohort) ? 'all' : filterKey,
    );
    let filtered = base;
    if (ISO_DAY.test(dateFilter)) {
      filtered = base.filter((r) => calendarDayKeyInPortalTz(r.dateOfReading || '') === dateFilter);
    } else if (ISO_DAY.test(fromFilter) && ISO_DAY.test(toFilter)) {
      const lo = fromFilter <= toFilter ? fromFilter : toFilter;
      const hi = fromFilter <= toFilter ? toFilter : fromFilter;
      filtered = base.filter((r) => {
        const day = calendarDayKeyInPortalTz(r.dateOfReading || '');
        return Boolean(day && day >= lo && day <= hi);
      });
    } else if (presetWindow) {
      filtered = base.filter((r) => {
        const day = calendarDayKeyInPortalTz(r.dateOfReading || '');
        return Boolean(day && day >= presetWindow.from && day <= presetWindow.to);
      });
    }
    if (appVersionParam) {
      filtered = filtered.filter((r) => normalizeReadingAppVersion(r) === appVersionParam);
    }
    if (capturedParam) {
      const q = capturedParam.toLowerCase();
      filtered = filtered.filter((r) => (r.userName || '').toLowerCase().includes(q));
    }
    if (activeCohort) {
      filtered = filtered.filter((r) => matchesReadingsCohort(r, activeCohort));
    }
    return sortReadingsForList(filtered, filterKey, effectiveListSort, effectiveListSortDir);
  }, [
    getReadingsByStatus,
    listStatusKey,
    dateFilter,
    fromFilter,
    toFilter,
    presetWindow,
    appVersionParam,
    capturedParam,
    activeCohort,
    effectiveListSort,
    effectiveListSortDir,
    location.search,
  ]);

  const openReading = useCallback(
    (reading: S3MeterReading) => {
      const sp = new URLSearchParams(searchParams);
      sp.set('workType', workType);
      navigate(
        {
          pathname: `/reading/${encodeURIComponent(reading.id)}`,
          search: sp.toString() ? `?${sp.toString()}` : '',
        },
        {
          state: {
            readingQueueIds: readings.map((r) => r.id),
            listReturn: { pathname: location.pathname, search: location.search },
          },
        },
      );
    },
    [navigate, searchParams, workType, readings, location.pathname, location.search],
  );

  const clearListFilters = () => setSearchParams({}, { replace: true });

  const setCohortParam = useCallback(
    (next: ReadingsCohortId | null) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('trainingPick');
          n.delete('stage');
          if (!next) n.delete('cohort');
          else n.set('cohort', next);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearDateRangeFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('date');
        n.delete('from');
        n.delete('to');
        n.delete('range');
        return n;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const applyRangePreset = useCallback(
    (preset: DateRangePresetId) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('date');
          n.delete('from');
          n.delete('to');
          n.set('range', preset);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const applyCapturedFilter = useCallback(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        const t = capturedDraft.trim();
        if (t) n.set('captured', t);
        else n.delete('captured');
        return n;
      },
      { replace: true },
    );
  }, [setSearchParams, capturedDraft]);

  const chartRangeWindow = useMemo(() => {
    if (ISO_DAY.test(dateFilter)) return null;
    if (!ISO_DAY.test(fromFilter) || !ISO_DAY.test(toFilter)) return null;
    const lo = fromFilter <= toFilter ? fromFilter : toFilter;
    const hi = fromFilter <= toFilter ? toFilter : fromFilter;
    return { lo, hi };
  }, [dateFilter, fromFilter, toFilter]);

  const rangeSubtitle = useMemo(() => {
    if (!chartRangeWindow) return null;
    const { lo, hi } = chartRangeWindow;
    const fmt = (iso: string) =>
      new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    if (lo === hi) return fmt(lo);
    return `${fmt(lo)} – ${fmt(hi)}`;
  }, [chartRangeWindow]);

  const zipExportOpts = useMemo((): ListExportDateOpts | undefined => {
    const o: ListExportDateOpts = {};
    if (ISO_DAY.test(dateFilter)) o.date = dateFilter;
    else if (chartRangeWindow) {
      o.from = chartRangeWindow.lo;
      o.to = chartRangeWindow.hi;
    } else if (presetWindow) {
      o.from = presetWindow.from;
      o.to = presetWindow.to;
    }
    if (appVersionParam) o.appVersion = appVersionParam;
    return Object.keys(o).length ? o : undefined;
  }, [dateFilter, chartRangeWindow, presetWindow, appVersionParam]);

  const appVersionSubtitle =
    appVersionParam === 'unknown'
      ? 'Unknown app version (missing in metadata)'
      : appVersionParam
        ? `App version ${appVersionParam}`
        : '';

  const showImagesColumn = Boolean(appVersionParam);
  const totalImagesInList = useMemo(
    () => readings.reduce((n, r) => n + (r.imageCount ?? (Array.isArray(r.images) ? r.images.length : 0)), 0),
    [readings],
  );

  const getStatusTitle = () => {
    if (status === 'all') return 'All Readings';
    if (status === 'incorrect-queues') return 'Incorrect queues';
    return statusLabels[status as ReadingStatus] || 'Readings';
  };

  const dateFilterLabel =
    dateFilter && ISO_DAY.test(dateFilter)
      ? new Date(`${dateFilter}T12:00:00`).toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';

  const getStatusColor = () => {
    if (status === 'all') return '#64748b';
    if (status === 'incorrect-queues') return '#d97706';
    return statusColors[status as ReadingStatus] || '#64748b';
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === readings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(readings.map(r => r.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Get available target statuses (exclude current status)
  const getAvailableStatuses = (): ReadingStatus[] => {
    const allStatuses: ReadingStatus[] = [
      'correct',
      'incorrect_new',
      'incorrect_analyzed',
      'incorrect_labeled',
      'incorrect_training',
      'no_dials',
      'not_sure',
    ];
    return allStatuses.filter(s => s !== status);
  };

  // Handle bulk move
  const handleBulkMove = async () => {
    if (selectedIds.size === 0) return;

    setIsMoving(true);
    try {
      await bulkUpdateStatus(Array.from(selectedIds), targetStatus);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to move readings:', error);
      window.alert(error instanceof Error ? error.message : 'Failed to move selected readings.');
    } finally {
      setIsMoving(false);
    }
  };

  const isAllSelected = readings.length > 0 && selectedIds.size === readings.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < readings.length;

  const listStatusForZip = (status ?? 'all') as string;

  const handleDownloadListZip = useCallback(async () => {
    if (!isUsingRealData) {
      window.alert('Start the API server and refresh, then try again.');
      return;
    }
    setZipExporting(true);
    try {
      await downloadListRetrainZip(dataSource, workType, listStatusForZip, zipExportOpts);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setZipExporting(false);
    }
  }, [isUsingRealData, dataSource, workType, listStatusForZip, zipExportOpts]);

  useEffect(() => {
    if (!isUsingRealData || !showTrainingCopy) {
      setTrainingFolders([]);
      return;
    }
    let cancelled = false;
    setTrainingFoldersLoading(true);
    void fetchTrainingDatasets()
      .then((data) => {
        if (cancelled) return;
        const opts = data.datasets
          .filter((d) => !d.manifestMissing)
          .map((d) => ({
            folderPrefix: d.folderPrefix,
            label: d.displayName,
          }));
        setTrainingFolders(opts);
        setTrainingFolderPrefix((prev) => {
          if (prev && opts.some((o) => o.folderPrefix === prev)) return prev;
          return opts[0]?.folderPrefix ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) setTrainingFolders([]);
      })
      .finally(() => {
        if (!cancelled) setTrainingFoldersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isUsingRealData, showTrainingCopy]);

  useEffect(() => {
    if (!pipelineSeg || !showTrainingCopy || trainingFolders.length === 0) return;
    const hit = trainingFolders.find((t) => folderPrefixToSegment(t.folderPrefix) === pipelineSeg);
    if (hit) setTrainingFolderPrefix(hit.folderPrefix);
  }, [pipelineSeg, trainingFolders, showTrainingCopy]);

  const handleCopyToTrainingDataset = useCallback(async () => {
    if (!isUsingRealData) {
      window.alert('Start the API server and refresh, then try again.');
      return;
    }
    if (!trainingFolderPrefix) {
      window.alert('Create a pipeline on the Training page first, then open this list again.');
      return;
    }
    if (selectedIds.size === 0) return;
    setTrainingCopyMessage(null);
    setCopyingToTraining(true);
    setCopyToTrainingProgress(null);
    try {
      const picked = readings.filter((r) => selectedIds.has(r.id));
      const sessions = picked.map((r) => ({
        sessionId: r.id,
        s3SessionPrefix: r.s3SessionPrefix,
        workType,
      }));
      const allCopied: CopySessionsToTrainingDatasetResult['copied'] = [];
      const allErrors: CopySessionsToTrainingDatasetResult['errors'] = [];
      const total = sessions.length;
      setCopyToTrainingProgress({ done: 0, total });
      for (let i = 0; i < sessions.length; i++) {
        const res = await copySessionsToTrainingDataset(trainingFolderPrefix, [sessions[i]]);
        allCopied.push(...res.copied);
        allErrors.push(...res.errors);
        setCopyToTrainingProgress({ done: i + 1, total });
      }
      const ok = allCopied.length;
      const bad = allErrors.length;
      setTrainingCopyMessage(
        bad
          ? `Copied ${ok} of ${total} session(s). ${bad} failed — check the alert for details.`
          : `Copied ${ok} session(s) into the pipeline. Open the pipeline on Training to see thumbnails, or download ZIP when ready.`,
      );
      if (bad) {
        window.alert(allErrors.map((e) => `${e.sessionId}: ${e.error}`).join('\n'));
      }
      if (ok > 0) {
        setSelectedIds(new Set());
        await refreshData();
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Copy to training dataset failed.');
    } finally {
      setCopyingToTraining(false);
      setCopyToTrainingProgress(null);
    }
  }, [
    isUsingRealData,
    trainingFolderPrefix,
    selectedIds,
    readings,
    workType,
    refreshData,
  ]);

  return (
    <div className="readings-list-page">
      <header className="page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
          <button className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <div className="page-title">
            <Gauge size={32} strokeWidth={1.5} />
            <div>
              <h1>{getStatusTitle()}</h1>
              <p>
                {readings.length} reading{readings.length !== 1 ? 's' : ''} found
                {dateFilterLabel ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">· {dateFilterLabel}</span>
                  </>
                ) : rangeSubtitle ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">· {rangeSubtitle}</span>
                  </>
                ) : null}
                {appVersionSubtitle ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">· {appVersionSubtitle}</span>
                    {showImagesColumn && readings.length > 0 ? (
                      <span className="readings-date-filter"> · {totalImagesInList} images</span>
                    ) : null}
                  </>
                ) : null}
                {rangePreset ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">· {formatPresetLabel(rangePreset)}</span>
                  </>
                ) : null}
                {activeCohort ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">· {READINGS_COHORT_LABELS[activeCohort]}</span>
                  </>
                ) : null}
                {capturedParam ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">
                      · Captured: <strong>{capturedParam}</strong>
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          </div>
          <ListPageRefreshButton
            onRefresh={() => void handleListRefresh()}
            busy={listRefreshing}
            disabled={readingsLoading}
            title="Refresh sessions"
          />
        </div>
      </header>

      {dateFilterLabel && (
        <div className="readings-filter-banner">
          <p>
            Showing uploads on <strong>{dateFilter}</strong> (from dashboard chart).{' '}
            <button type="button" className="readings-filter-clear" onClick={clearListFilters}>
              Clear filter
            </button>
          </p>
        </div>
      )}
      {chartRangeWindow && !dateFilterLabel && (
        <div className="readings-filter-banner">
          <p>
            {chartRangeWindow.lo === chartRangeWindow.hi ? (
              <>
                Showing uploads on <strong>{chartRangeWindow.lo}</strong> (dashboard time window).{' '}
              </>
            ) : (
              <>
                Showing uploads from <strong>{chartRangeWindow.lo}</strong> through{' '}
                <strong>{chartRangeWindow.hi}</strong> (dashboard time window).{' '}
              </>
            )}
            <button type="button" className="readings-filter-clear" onClick={clearListFilters}>
              Clear filter
            </button>
          </p>
        </div>
      )}
      {appVersionParam && (
        <div className="readings-filter-banner">
          <p>
            Showing sessions whose metadata <code>app_version</code> matches{' '}
            <strong>
              <code>{appVersionParam === 'unknown' ? 'unknown (missing in metadata)' : appVersionParam}</code>
            </strong>
            . Open a row to see which images belong to that capture.{' '}
            <button type="button" className="readings-filter-clear" onClick={clearListFilters}>
              Clear filter
            </button>
          </p>
        </div>
      )}

      <div className="export-list-zip-bar">
        <p>
          Download a ZIP of sessions that match <strong>this list</strong> (toolbar work type + source
          {listStatusForZip !== 'all' ? (
            <>
              {' '}
              · list: <strong>{getStatusTitle()}</strong>
            </>
          ) : null}
          {zipExportOpts?.date ? (
            <>
              {' '}
              · upload day <strong>{zipExportOpts.date}</strong>
            </>
          ) : zipExportOpts?.from && zipExportOpts?.to ? (
            <>
              {' '}
              · uploads{' '}
              <strong>{zipExportOpts.from}</strong>
              {zipExportOpts.from !== zipExportOpts.to ? (
                <>
                  {' '}
                  – <strong>{zipExportOpts.to}</strong>
                </>
              ) : null}
            </>
          ) : null}
          {zipExportOpts?.appVersion ? (
            <>
              {' '}
              · app version <strong>{zipExportOpts.appVersion === 'unknown' ? 'unknown' : zipExportOpts.appVersion}</strong>
            </>
          ) : null}
          ). Includes all sessions matching these filters, not only the rows on this page. Downloads as a ZIP of
          full-frame images.
        </p>
        <button
          type="button"
          className="export-list-zip-bar-btn"
          onClick={handleDownloadListZip}
          disabled={zipExporting || !isUsingRealData}
        >
          {zipExporting ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
          <span>{zipExporting ? 'Building ZIP…' : 'Download ZIP'}</span>
        </button>
      </div>

      <div className="readings-list-filter-toolbar">
        <div className="readings-list-filter-toolbar-head">
          <SlidersHorizontal size={16} aria-hidden />
          <span>List filters</span>
        </div>
        <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort">
          <span className="readings-list-filter-label">Show</span>
          <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
            <button
              type="button"
              className={`readings-list-filter-chip${!activeCohort ? ' active' : ''}`}
              onClick={() => setCohortParam(null)}
              aria-pressed={!activeCohort}
            >
              All
            </button>
            {READINGS_COHORT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`readings-list-filter-chip${activeCohort === id ? ' active' : ''}`}
                onClick={() => setCohortParam(activeCohort === id ? null : id)}
                aria-pressed={activeCohort === id}
              >
                {READINGS_COHORT_LABELS[id]}
              </button>
            ))}
          </div>
        </div>
        <div className="readings-list-filter-toolbar-row">
          <span className="readings-list-filter-label">When captured</span>
          <div className="readings-list-filter-chips">
            {(['today', 'yesterday', 'last7', 'last30'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`readings-list-filter-chip ${rangePreset === id ? 'active' : ''}`}
                onClick={() => applyRangePreset(id)}
              >
                {formatPresetLabel(id)}
              </button>
            ))}
            {rangePreset || ISO_DAY.test(dateFilter) || (ISO_DAY.test(fromFilter) && ISO_DAY.test(toFilter)) ? (
              <button
                type="button"
                className="readings-list-filter-chip readings-list-filter-chip-muted"
                onClick={clearDateRangeFilters}
              >
                Clear dates
              </button>
            ) : null}
          </div>
        </div>
        <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-grow">
          <span className="readings-list-filter-label">Captured by</span>
          <input
            type="search"
            className="readings-list-filter-input"
            placeholder="Name or email contains…"
            value={capturedDraft}
            onChange={(e) => setCapturedDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyCapturedFilter();
              }
            }}
            aria-label="Filter by collector name or email"
          />
          <button type="button" className="readings-list-filter-apply" onClick={() => applyCapturedFilter()}>
            Apply
          </button>
          {capturedParam ? (
            <button
              type="button"
              className="readings-list-filter-clear-inline"
              onClick={() => {
                setCapturedDraft('');
                setSearchParams(
                  (prev) => {
                    const n = new URLSearchParams(prev);
                    n.delete('captured');
                    return n;
                  },
                  { replace: true },
                );
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="readings-list-filter-toolbar-row">
          <span className="readings-list-filter-label">Source</span>
          <div className="readings-list-filter-chips readings-list-source-chips">
            {(
              [
                { value: 'all' as const, label: 'All', icon: null },
                { value: 'field' as const, label: 'Field', icon: <Radio size={14} aria-hidden /> },
                { value: 'simulator' as const, label: 'Simulator', icon: <Monitor size={14} aria-hidden /> },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`readings-list-filter-chip readings-list-source-chip${dataSource === opt.value ? ' active' : ''}`}
                onClick={() => setDataSource(opt.value)}
                aria-pressed={dataSource === opt.value}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="readings-list-filter-toolbar-row field-test-readings-view-mode-row">
          <CaptureViewModeToggle mode={viewMode} onChange={setViewMode} />
          <span className="field-test-view-mode-hint">
            {viewMode === 'map' ? 'Tap a pin to open capture detail' : 'Table view with bulk actions'}
          </span>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {viewMode === 'list' && selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <div className="bulk-action-bar-top">
            <div className="selection-info">
              <CheckSquare size={20} />
              <span>{selectedIds.size} reading{selectedIds.size !== 1 ? 's' : ''} selected</span>
              <button type="button" className="clear-selection" onClick={clearSelection}>
                <X size={16} />
                Clear
              </button>
            </div>
            {showBulkMove ? (
              <div className="bulk-actions">
                <label className="move-label" htmlFor="bulk-move-status">
                  Move to:
                </label>
                <select
                  id="bulk-move-status"
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as ReadingStatus)}
                  className="status-select"
                >
                  {getAvailableStatuses().map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
                <button type="button" className="move-button" onClick={handleBulkMove} disabled={isMoving}>
                  {isMoving ? (
                    <>
                      <Loader2 size={18} className="spin" />
                      <span>Moving...</span>
                    </>
                  ) : (
                    <>
                      <ArrowRightCircle size={18} />
                      <span>Move Selected</span>
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </div>
          {showBulkMove ? (
            <div className="bulk-quick-targets" aria-label="Quick pipeline targets">
              <span className="bulk-quick-targets-label">Quick pipeline target</span>
              <div className="bulk-quick-targets-row">
                {INCORRECT_PIPELINE_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`bulk-quick-target-btn ${targetStatus === s ? 'active' : ''}`}
                    onClick={() => setTargetStatus(s)}
                  >
                    {labelerPipelineStatusLabels[s as keyof typeof labelerPipelineStatusLabels]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {showTrainingCopy ? (
            <div className="bulk-training-block">
              <div className="bulk-action-bar-training">
                <FolderInput size={18} className="bulk-training-icon" aria-hidden />
                <span className="bulk-training-label">exports folder (copy only; list does not move):</span>
                <select
                  className="status-select bulk-training-select"
                  value={trainingFolderPrefix}
                  onChange={(e) => setTrainingFolderPrefix(e.target.value)}
                  disabled={trainingFoldersLoading || trainingFolders.length === 0}
                  aria-label="Training dataset folder"
                >
                  {trainingFolders.length === 0 ? (
                    <option value="">create a pipeline under Training first</option>
                  ) : (
                    trainingFolders.map((t) => (
                      <option key={t.folderPrefix} value={t.folderPrefix}>
                        {t.label}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="bulk-training-copy-btn"
                  onClick={() => void handleCopyToTrainingDataset()}
                  disabled={copyingToTraining || !trainingFolderPrefix || trainingFolders.length === 0}
                >
                  {copyingToTraining ? (
                    <>
                      <Loader2 size={18} className="spin" aria-hidden />
                      <span>
                        {copyToTrainingProgress && copyToTrainingProgress.total > 0
                          ? `${Math.round((copyToTrainingProgress.done / copyToTrainingProgress.total) * 100)}%`
                          : 'Copying…'}
                      </span>
                    </>
                  ) : (
                    <span>copy into folder</span>
                  )}
                </button>
              </div>
              {copyingToTraining && copyToTrainingProgress && copyToTrainingProgress.total > 0 ? (
                <div
                  className="bulk-training-copy-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(
                    (copyToTrainingProgress.done / copyToTrainingProgress.total) * 100,
                  )}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Copy to training folder progress"
                >
                  <div
                    className="bulk-training-copy-progress-fill"
                    style={{
                      width: `${Math.round((copyToTrainingProgress.done / copyToTrainingProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              ) : null}
              {copyingToTraining && copyToTrainingProgress && copyToTrainingProgress.total > 0 ? (
                <p className="bulk-training-copy-progress-label" aria-live="polite">
                  {copyToTrainingProgress.done} / {copyToTrainingProgress.total} sessions copied to folder (
                  {Math.round((copyToTrainingProgress.done / copyToTrainingProgress.total) * 100)}%)
                </p>
              ) : null}
              {trainingCopyMessage ? <p className="bulk-training-message">{trainingCopyMessage}</p> : null}
            </div>
          ) : null}
        </div>
      )}

      <main className="list-content">
        {readingsLoading && readings.length === 0 ? (
          <ListViewLoading message="Loading sessions…" />
        ) : (
        <>
        {readings.length > 0 ? (
          <CaptureMapViewKeepAlive
            active={viewMode === 'map'}
            readings={readings}
            onSelectReading={openReading}
          />
        ) : null}
        {viewMode === 'map' && readings.length === 0 ? (
          <div className="empty-state">
            <p>No readings to show on the map for this list and filters.</p>
          </div>
        ) : viewMode === 'list' ? (
        <div className="table-container">
          {readingsLoading ? (
            <ListViewLoading variant="inline" message="Refreshing sessions…" />
          ) : null}
          <table className="readings-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <button 
                    className={`checkbox-button ${isAllSelected ? 'checked' : ''} ${isSomeSelected ? 'indeterminate' : ''}`}
                    onClick={toggleSelectAll}
                    title={isAllSelected ? 'Deselect all' : 'Select all'}
                  >
                    {isAllSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </th>
                <th>Location</th>
                <th>Source</th>
                <th>Status</th>
                <th scope="col" className="readings-th-sortable">
                  <button
                    type="button"
                    className={`readings-table-sort-th${effectiveListSort === 'date' ? ' readings-table-sort-th--active' : ''}`}
                    onClick={() => toggleListSort('date')}
                    aria-pressed={effectiveListSort === 'date'}
                    title={
                      effectiveListSort === 'date'
                        ? effectiveListSortDir === 'desc'
                          ? 'Sorted by date (newest first); click for oldest first'
                          : 'Sorted by date (oldest first); click for newest first'
                        : 'Sort by date of reading'
                    }
                  >
                    <span>Date of reading</span>
                    {effectiveListSort === 'date' ? (
                      effectiveListSortDir === 'desc' ? (
                        <ArrowDown size={14} className="readings-table-sort-icon" aria-hidden />
                      ) : (
                        <ArrowUp size={14} className="readings-table-sort-icon" aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
                <th>Captured by</th>
                <th className="readings-th-meter-value">Meter value</th>
                <th scope="col" className="readings-col-confidence readings-th-sortable readings-th-sortable--right">
                  <button
                    type="button"
                    className={`readings-table-sort-th readings-table-sort-th--right readings-table-sort-th--confidence${effectiveListSort === 'confidence' ? ' readings-table-sort-th--active' : ''}`}
                    onClick={() => toggleListSort('confidence')}
                    aria-pressed={effectiveListSort === 'confidence'}
                    title={
                      effectiveListSort === 'confidence'
                        ? effectiveListSortDir === 'asc'
                          ? 'Sorted by confidence (lowest first); click for highest first'
                          : 'Sorted by confidence (highest first); click for lowest first'
                        : 'Sort by confidence'
                    }
                  >
                    <span className="readings-th-confidence-text">Confidence</span>
                    {effectiveListSort === 'confidence' ? (
                      effectiveListSortDir === 'asc' ? (
                        <ArrowUp size={14} className="readings-table-sort-icon" aria-hidden />
                      ) : (
                        <ArrowDown size={14} className="readings-table-sort-icon" aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
                {showImagesColumn ? <th className="readings-col-images">Images</th> : null}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading) => (
                <tr 
                  key={reading.id} 
                  className={selectedIds.has(reading.id) ? 'selected' : ''}
                >
                  <td className="checkbox-col" data-label="Select">
                    <button 
                      className={`checkbox-button ${selectedIds.has(reading.id) ? 'checked' : ''}`}
                      onClick={() => toggleSelect(reading.id)}
                    >
                      {selectedIds.has(reading.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  </td>
                  <td data-label="Location">
                    <div
                      className="cell-with-icon"
                      title={
                        reading.captureLocation?.coordinateLabel ||
                        (reading.captureLocation?.latitude != null &&
                        reading.captureLocation?.longitude != null
                          ? `${reading.captureLocation.latitude}, ${reading.captureLocation.longitude}`
                          : undefined)
                      }
                    >
                      <MapPin size={16} className="cell-icon" />
                      <span>
                        {captureLocationListLine(reading.captureLocation) || reading.location || '—'}
                      </span>
                    </div>
                  </td>
                  <td data-label="Source">
                    <div className={`type-badge ${reading.type}`}>
                      {reading.type === 'simulator' ? (
                        <Monitor size={14} />
                      ) : (
                        <Radio size={14} />
                      )}
                      <span>{reading.type === 'simulator' ? 'Simulator' : 'Field'}</span>
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className="readings-status-cell">
                      {(() => {
                        const { label, color } = getReadingListStatusDisplay(reading);
                        return (
                      <span
                        className="status-badge"
                        style={{
                          backgroundColor: `${color}20`,
                          color,
                          borderColor: color,
                        }}
                      >
                        {label}
                      </span>
                        );
                      })()}
                      {reading.reviewerRecommendTraining ? (
                        <span className="readings-training-pick-badge" title="Reviewer sent to training dataset">
                          Training
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="Date">
                    <div className="cell-with-icon">
                      <Calendar size={16} className="cell-icon" />
                      <span>{formatReadingShortDate(reading.dateOfReading)}</span>
                    </div>
                  </td>
                  <td data-label="Captured by">
                    <div className="cell-with-icon readings-col-captured">
                      <User size={16} className="cell-icon" aria-hidden />
                      <span className="readings-col-captured-text" title={reading.userName || undefined}>
                        {reading.userName?.trim() ? reading.userName : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="readings-td-meter-value" data-label="Meter value">
                    <span className="meter-value">{reading.meterValue}</span>
                  </td>
                  <td className="readings-col-confidence" data-label="Confidence">
                    {(() => {
                      const c = effectiveConfidenceForDisplay(reading);
                      if (c === undefined) {
                        return <span className="readings-confidence-missing">—</span>;
                      }
                      const fromSession = normalizeConfidenceScalar(reading.confidence) !== undefined;
                      return (
                        <span
                          title={
                            fromSession
                              ? 'Model confidence for this reading'
                              : 'Minimum dial confidence (no session-level score in metadata)'
                          }
                        >
                          {(c * 100).toFixed(0)}%
                        </span>
                      );
                    })()}
                  </td>
                  {showImagesColumn ? (
                    <td className="readings-col-images" data-label="Images">
                      <span className="meter-value">{reading.imageCount ?? (Array.isArray(reading.images) ? reading.images.length : 0)}</span>
                    </td>
                  ) : null}
                  <td data-label="Actions">
                    <button
                      className="view-button"
                      onClick={() => openReading(reading)}
                      style={{ '--accent': getStatusColor() } as CSSProperties}
                    >
                      <Eye size={16} />
                      <span>View Images</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {readings.length === 0 && !readingsLoading ? (
            <div className="empty-state">
              <p>
                {dateFilterLabel ||
                chartRangeWindow ||
                appVersionParam ||
                rangePreset ||
                activeCohort ||
                capturedParam
                  ? 'No readings match this status and the active filters. Try clearing filters or changing work type / source in the toolbar.'
                  : 'No readings found with this status.'}
              </p>
            </div>
          ) : null}
        </div>
        ) : null}
        </>
        )}
      </main>
    </div>
  );
};

export default ReadingsList;
