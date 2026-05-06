import { useState, useMemo, useCallback, type CSSProperties, type FC } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import type { ReadingStatus, ReadingsListFilter } from '../types';
import { statusLabels, statusColors } from '../types';
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
} from 'lucide-react';
import { downloadListRetrainZip, type ListExportDateOpts } from '../services/api';
import type { S3MeterReading } from '../services/api';

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
  const [zipExporting, setZipExporting] = useState(false);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<ReadingStatus>('incorrect_analyzed');
  const [isMoving, setIsMoving] = useState(false);

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

  const readings = useMemo(() => {
    const filterKey = (status ?? 'all') as ReadingsListFilter;
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
    }
    if (appVersionParam) {
      filtered = filtered.filter((r) => normalizeReadingAppVersion(r) === appVersionParam);
    }
    const sortKey = filterKey === 'incorrect-queues' ? 'all' : filterKey;
    return sortReadingsForList(filtered, sortKey);
  }, [getReadingsByStatus, status, dateFilter, fromFilter, toFilter, appVersionParam]);

  const clearListFilters = () => setSearchParams({}, { replace: true });

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
    }
    if (appVersionParam) o.appVersion = appVersionParam;
    return Object.keys(o).length ? o : undefined;
  }, [dateFilter, chartRangeWindow, appVersionParam]);

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

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <div className="selection-info">
            <CheckSquare size={20} />
            <span>{selectedIds.size} reading{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <button className="clear-selection" onClick={clearSelection}>
              <X size={16} />
              Clear
            </button>
          </div>
          <div className="bulk-actions">
            <label className="move-label">Move to:</label>
            <select 
              value={targetStatus} 
              onChange={(e) => setTargetStatus(e.target.value as ReadingStatus)}
              className="status-select"
            >
              {getAvailableStatuses().map(s => (
                <option key={s} value={s}>{statusLabels[s]}</option>
              ))}
            </select>
            <button 
              className="move-button"
              onClick={handleBulkMove}
              disabled={isMoving}
            >
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
                <th>Date of Reading</th>
                <th>Location</th>
                <th>Type</th>
                <th>Status</th>
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
                      <Calendar size={16} className="cell-icon" />
                      <span>{formatDate(reading.dateOfReading)}</span>
                    </div>
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
                        borderColor: statusColors[reading.status]
                      }}
                    >
                      {statusLabels[reading.status]}
                    </span>
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
                      onClick={() => navigate(`/reading/${encodeURIComponent(reading.id)}?workType=${workType}`)}
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
                {dateFilterLabel || chartRangeWindow || appVersionParam
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
