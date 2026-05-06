import { useState, useMemo, useCallback, useEffect, type CSSProperties, type FC } from 'react';
import { useParams, useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import type { ReadingStatus, ReadingsListFilter } from '../types';
import {
  statusLabels,
  statusColors,
  INCORRECT_PIPELINE_STATUSES,
  labelerPipelineStatusLabels,
  isIncorrectPipelineStatus,
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

/** When browsing all statuses, surface the labeling queue (incorrect_new) first, then pipeline order, then correct. */
const LIST_PRIORITY: Record<string, number> = {
  incorrect_new: 0,
  incorrect_analyzed: 1,
  incorrect_labeled: 2,
  incorrect_training: 3,
  not_sure: 4,
  no_dials: 5,
  correct: 6,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeReadingAppVersion(r: S3MeterReading): string {
  const raw =
    r.appVersion != null && String(r.appVersion).trim() !== ''
      ? String(r.appVersion).trim()
      : 'unknown';
  return raw;
}

function sortReadingsForList(readings: S3MeterReading[], listStatus: string | undefined): S3MeterReading[] {
  const byDateDesc = (a: S3MeterReading, b: S3MeterReading) =>
    new Date(b.dateOfReading).getTime() - new Date(a.dateOfReading).getTime();
  if (listStatus !== 'all') {
    return [...readings].sort(byDateDesc);
  }
  return [...readings].sort((a, b) => {
    const pa = LIST_PRIORITY[a.status] ?? 99;
    const pb = LIST_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return byDateDesc(a, b);
  });
}

const ReadingsList: FC = () => {
  const { status } = useParams<{ status: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getReadingsByStatus, bulkUpdateStatus, workType, dataSource, isUsingRealData } = useReadings();
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

  const stageRaw = (searchParams.get('stage') || '').trim() as ReadingStatus;

  const listStatusKey = (status ?? 'all') as ReadingsListFilter;
  const showPipelineStageFilter = listStatusKey === 'all' || listStatusKey === 'incorrect-queues';
  const activePipelineStageFilter =
    showPipelineStageFilter && isIncorrectPipelineStatus(stageRaw) ? stageRaw : null;

  const [capturedDraft, setCapturedDraft] = useState(capturedParam);
  useEffect(() => {
    setCapturedDraft(capturedParam);
  }, [capturedParam]);

  const readings = useMemo(() => {
    const filterKey = listStatusKey;
    const base = getReadingsByStatus(filterKey);
    let filtered = base;
    if (ISO_DAY.test(dateFilter)) {
      filtered = base.filter((r) => (r.dateOfReading || '').split('T')[0] === dateFilter);
    } else if (ISO_DAY.test(fromFilter) && ISO_DAY.test(toFilter)) {
      const lo = fromFilter <= toFilter ? fromFilter : toFilter;
      const hi = fromFilter <= toFilter ? toFilter : fromFilter;
      filtered = base.filter((r) => {
        const day = (r.dateOfReading || '').split('T')[0];
        return Boolean(day && day >= lo && day <= hi);
      });
    } else if (presetWindow) {
      filtered = base.filter((r) => {
        const day = (r.dateOfReading || '').split('T')[0];
        return Boolean(day && day >= presetWindow.from && day <= presetWindow.to);
      });
    }
    if (appVersionParam) {
      filtered = filtered.filter((r) => normalizeReadingAppVersion(r) === appVersionParam);
    }
    if (activePipelineStageFilter) {
      filtered = filtered.filter((r) => r.status === activePipelineStageFilter);
    }
    if (capturedParam) {
      const q = capturedParam.toLowerCase();
      filtered = filtered.filter((r) => (r.userName || '').toLowerCase().includes(q));
    }
    const sortKey = filterKey === 'incorrect-queues' ? 'all' : filterKey;
    return sortReadingsForList(filtered, sortKey);
  }, [
    getReadingsByStatus,
    listStatusKey,
    dateFilter,
    fromFilter,
    toFilter,
    presetWindow,
    appVersionParam,
    activePipelineStageFilter,
    capturedParam,
  ]);

  const clearListFilters = () => setSearchParams({}, { replace: true });

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

  const setPipelineStageParam = useCallback(
    (stage: string) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (!stage) n.delete('stage');
          else n.set('stage', stage);
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
    () => readings.reduce((n, r) => n + (Array.isArray(r.images) ? r.images.length : 0), 0),
    [readings],
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
      window.alert('Start the API server and use live S3 data, then try again.');
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
      window.alert('Start the API server and use live S3 data, then try again.');
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
  ]);

  return (
    <div className="readings-list-page">
      <header className="page-header">
        <div className="header-content">
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
                {activePipelineStageFilter ? (
                  <>
                    {' '}
                    <span className="readings-date-filter">
                      · Pipeline:{' '}
                      {
                        labelerPipelineStatusLabels[
                          activePipelineStageFilter as keyof typeof labelerPipelineStatusLabels
                        ]
                      }
                    </span>
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
          ). Uses the full S3 slice for those filters, not only the rows on this page. Each session is one folder with
          images and <code>metadata.json</code>.
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
        <div className="readings-list-filter-toolbar-row">
          {showPipelineStageFilter ? (
            <>
              <span className="readings-list-filter-label">Incorrect queue</span>
              <select
                className="readings-list-filter-select"
                value={activePipelineStageFilter ?? ''}
                onChange={(e) => setPipelineStageParam(e.target.value)}
                aria-label="Filter by incorrect pipeline stage"
              >
                <option value="">All pipeline stages</option>
                {INCORRECT_PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labelerPipelineStatusLabels[s as keyof typeof labelerPipelineStatusLabels]}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="readings-list-filter-hint">
              Open “All readings” or “Incorrect queues” to filter by pipeline stage (for example New only).
            </span>
          )}
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
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
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
        <div className="table-container">
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
                <th>Type</th>
                <th>Status</th>
                <th>Date of reading</th>
                <th>Captured by</th>
                <th>Meter Value</th>
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
                  <td className="checkbox-col">
                    <button 
                      className={`checkbox-button ${selectedIds.has(reading.id) ? 'checked' : ''}`}
                      onClick={() => toggleSelect(reading.id)}
                    >
                      {selectedIds.has(reading.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  </td>
                  <td>
                    <div className="cell-with-icon">
                      <MapPin size={16} className="cell-icon" />
                      <span>{reading.location}</span>
                    </div>
                  </td>
                  <td>
                    <div className={`type-badge ${reading.type}`}>
                      {reading.type === 'simulator' ? (
                        <Monitor size={14} />
                      ) : (
                        <Radio size={14} />
                      )}
                      <span>{reading.type === 'simulator' ? 'Simulator' : 'Field'}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      className="status-badge"
                      style={{
                        backgroundColor: `${statusColors[reading.status]}20`,
                        color: statusColors[reading.status],
                        borderColor: statusColors[reading.status],
                      }}
                    >
                      {statusLabels[reading.status]}
                    </span>
                  </td>
                  <td>
                    <div className="cell-with-icon">
                      <Calendar size={16} className="cell-icon" />
                      <span>{formatDate(reading.dateOfReading)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-with-icon readings-col-captured">
                      <User size={16} className="cell-icon" aria-hidden />
                      <span className="readings-col-captured-text" title={reading.userName || undefined}>
                        {reading.userName?.trim() ? reading.userName : '—'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="meter-value">{reading.meterValue}</span>
                  </td>
                  {showImagesColumn ? (
                    <td className="readings-col-images">
                      <span className="meter-value">{Array.isArray(reading.images) ? reading.images.length : 0}</span>
                    </td>
                  ) : null}
                  <td>
                    <button
                      className="view-button"
                      onClick={() => {
                        const sp = new URLSearchParams(searchParams);
                        sp.set('workType', workType);
                        navigate(
                          {
                            pathname: `/reading/${encodeURIComponent(reading.id)}`,
                            search: sp.toString() ? `?${sp.toString()}` : '',
                          },
                          { state: { readingQueueIds: readings.map((r) => r.id) } },
                        );
                      }}
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
          {readings.length === 0 && (
            <div className="empty-state">
              <p>
                {dateFilterLabel ||
                chartRangeWindow ||
                appVersionParam ||
                rangePreset ||
                activePipelineStageFilter ||
                capturedParam
                  ? 'No readings match this status and the active filters. Try clearing filters or changing work type / source in the toolbar.'
                  : 'No readings found with this status.'}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ReadingsList;
