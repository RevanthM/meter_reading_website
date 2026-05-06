import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import {
  ArrowLeft,
  Gauge,
  Upload,
  CheckCircle,
  XCircle,
  HelpCircle,
  Loader2,
  Image,
  User,
  RefreshCw,
  Search,
  X,
  SlidersHorizontal,
  Eye,
  BarChart3,
  Download,
  Calendar,
} from 'lucide-react';
import type { ReadingStatus } from '../types';
import { statusLabels, INCORRECT_PIPELINE_STATUSES, labelerPipelineStatusLabels } from '../types';
import {
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from '../utils/dateRangePresets';

interface UploadEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  userEmail: string;
  sourceType: string;
  workType: string;
  imageCount: number;
  prediction: string;
  isCorrect: boolean;
  status: string;
}

type OwnerFilter = 'all' | 'mine';
type SourceFilter = 'all' | 'field' | 'simulator';
type StatusFilter = 'all' | 'correct' | 'incorrect' | 'not_sure' | 'no_dials';
type PipelineFilter = 'all' | ReadingStatus;
type DatePresetFilter = 'all' | DateRangePresetId;
type SortOption = 'newest' | 'oldest';

const STATUS_OPTIONS: { value: StatusFilter; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all', label: 'All Statuses', icon: <SlidersHorizontal size={14} />, color: 'var(--text-muted)' },
  { value: 'correct', label: 'Correct', icon: <CheckCircle size={14} />, color: '#10b981' },
  { value: 'incorrect', label: 'Incorrect', icon: <XCircle size={14} />, color: '#ef4444' },
  { value: 'not_sure', label: 'Not Sure', icon: <HelpCircle size={14} />, color: '#d29922' },
  { value: 'no_dials', label: 'No Dials', icon: <XCircle size={14} />, color: '#8b5cf6' },
];

function matchesStatus(upload: UploadEntry, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'correct') return upload.status === 'correct';
  if (filter === 'not_sure') return upload.status === 'not_sure';
  if (filter === 'no_dials') return upload.status === 'no_dials';
  // "incorrect" covers all incorrect sub-statuses
  return upload.status.startsWith('incorrect');
}

function matchesPipeline(upload: UploadEntry, pipeline: PipelineFilter): boolean {
  if (pipeline === 'all') return true;
  return upload.status === pipeline;
}

function matchesDatePreset(upload: UploadEntry, preset: DatePresetFilter): boolean {
  if (preset === 'all') return true;
  if (!isDateRangePresetId(preset)) return true;
  const { from, to } = getDateRangeFromPreset(preset);
  const day = (upload.timestamp || '').split('T')[0];
  return Boolean(day && day >= from && day <= to);
}

function uploadStatusLabel(status: string): string {
  if (status in statusLabels) return statusLabels[status as ReadingStatus];
  return status;
}

const UploadsTable: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail } = useAuth();
  const { workType } = useReadings();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('all');
  const [datePreset, setDatePreset] = useState<DatePresetFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadUploads();
  }, [workType]);

  const loadUploads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ workType });
      const response = await fetch(`/api/uploads?${params}`);
      if (response.ok) {
        const data = await response.json();
        setUploads(data);
      } else {
        setUploads([]);
      }
    } catch {
      setUploads([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredUploads = useMemo(() => {
    let result = uploads;

    if (ownerFilter === 'mine' && userEmail) {
      result = result.filter(u =>
        u.userEmail?.toLowerCase().includes(userEmail.toLowerCase())
      );
    }

    if (sourceFilter !== 'all') {
      result = result.filter(u => u.sourceType === sourceFilter);
    }

    result = result.filter(u => matchesStatus(u, statusFilter));
    result = result.filter((u) => matchesPipeline(u, pipelineFilter));
    result = result.filter((u) => matchesDatePreset(u, datePreset));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(u =>
        u.sessionId.toLowerCase().includes(q) ||
        u.prediction?.toLowerCase().includes(q) ||
        u.userEmail?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return sortBy === 'newest' ? tb - ta : ta - tb;
    });

    return result;
  }, [uploads, ownerFilter, sourceFilter, statusFilter, pipelineFilter, datePreset, sortBy, searchQuery, userEmail]);

  const activeFilterCount = [
    ownerFilter !== 'all',
    sourceFilter !== 'all',
    statusFilter !== 'all',
    pipelineFilter !== 'all',
    datePreset !== 'all',
    searchQuery.trim() !== '',
  ].filter(Boolean).length;

  const stats = useMemo(() => {
    const base = ownerFilter === 'mine' && userEmail
      ? uploads.filter(u => u.userEmail?.toLowerCase().includes(userEmail.toLowerCase()))
      : uploads;
    const correct = base.filter(u => u.status === 'correct').length;
    const incorrect = base.filter(u => u.status.startsWith('incorrect')).length;
    const accuracy = base.length > 0 ? ((correct / base.length) * 100).toFixed(1) : '0';
    return { total: base.length, correct, incorrect, accuracy };
  }, [uploads, ownerFilter, userEmail]);

  const clearAllFilters = () => {
    setOwnerFilter('all');
    setSourceFilter('all');
    setStatusFilter('all');
    setPipelineFilter('all');
    setDatePreset('all');
    setSearchQuery('');
    setSortBy('newest');
  };

  const exportCSV = () => {
    const headers = ['Session ID', 'Date', 'User', 'Source', 'Work Type', 'Images', 'Prediction', 'Status'];
    const rows = filteredUploads.map(u => [
      u.sessionId,
      new Date(u.timestamp).toISOString(),
      u.userEmail || 'Unknown',
      u.sourceType,
      u.workType,
      u.imageCount,
      u.prediction,
      u.status,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uploads-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="uploads-page">
      <header className="page-header">
        <div className="header-content">
          <button className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="page-title">
            <Gauge size={28} strokeWidth={1.5} />
            <div>
              <h1>Uploads</h1>
              <p>Track meter reading submissions</p>
            </div>
          </div>
        </div>
      </header>

      <div className="uploads-content">
        {/* Stats row */}
        <div className="uploads-stats-row">
          <div className="upload-stat-card">
            <Upload size={20} />
            <div className="upload-stat-value">{stats.total}</div>
            <div className="upload-stat-label">Total</div>
          </div>
          <div className="upload-stat-card correct">
            <CheckCircle size={20} />
            <div className="upload-stat-value">{stats.correct}</div>
            <div className="upload-stat-label">Correct</div>
          </div>
          <div className="upload-stat-card incorrect">
            <XCircle size={20} />
            <div className="upload-stat-value">{stats.incorrect}</div>
            <div className="upload-stat-label">Incorrect</div>
          </div>
          <div className="upload-stat-card accuracy">
            <BarChart3 size={20} />
            <div className="upload-stat-value">{stats.accuracy}%</div>
            <div className="upload-stat-label">Accuracy</div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="uploads-filter-bar">
          <div className="filter-row">
            {/* Owner filter chips */}
            <div className="filter-chips">
              <button
                className={`filter-chip ${ownerFilter === 'all' ? 'active' : ''}`}
                onClick={() => setOwnerFilter('all')}
              >
                <Upload size={14} />
                All Uploads
              </button>
              <button
                className={`filter-chip ${ownerFilter === 'mine' ? 'active' : ''}`}
                onClick={() => setOwnerFilter('mine')}
              >
                <User size={14} />
                My Uploads
              </button>
            </div>

            <div className="filter-actions">
              <span className="uploads-count">{filteredUploads.length} result{filteredUploads.length !== 1 ? 's' : ''}</span>
              <button className="export-button" onClick={exportCSV} title="Export CSV" disabled={filteredUploads.length === 0}>
                <Download size={16} />
                <span>Export</span>
              </button>
              <button className="refresh-button" onClick={loadUploads} title="Refresh">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="filter-row">
            {/* Source filter */}
            <div className="filter-group">
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                className="filter-select"
              >
                <option value="all">All Sources</option>
                <option value="field">Field</option>
                <option value="simulator">Simulator</option>
              </select>
            </div>

            {/* Status filter */}
            <div className="filter-group">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  setPipelineFilter('all');
                }}
                className="filter-select"
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Incorrect pipeline stage (when status is Incorrect) */}
            <div className="filter-group">
              <select
                value={pipelineFilter}
                onChange={(e) => setPipelineFilter(e.target.value as PipelineFilter)}
                className="filter-select"
                disabled={statusFilter !== 'incorrect'}
                title={statusFilter !== 'incorrect' ? 'Choose Incorrect in Status first' : 'Pipeline stage'}
              >
                <option value="all">All incorrect stages</option>
                {INCORRECT_PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labelerPipelineStatusLabels[s as keyof typeof labelerPipelineStatusLabels]}
                  </option>
                ))}
              </select>
            </div>

            {/* Captured when */}
            <div className="filter-group">
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePresetFilter)}
                className="filter-select"
              >
                <option value="all">Any date</option>
                <option value="today">{formatPresetLabel('today')}</option>
                <option value="yesterday">{formatPresetLabel('yesterday')}</option>
                <option value="last7">{formatPresetLabel('last7')}</option>
                <option value="last30">{formatPresetLabel('last30')}</option>
              </select>
            </div>

            {/* Sort */}
            <div className="filter-group">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="filter-select"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Search */}
            <div className="filter-search">
              <Search size={14} className="filter-search-icon" />
              <input
                type="text"
                placeholder="Search ID, prediction, user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="filter-search-clear" onClick={() => setSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
            </div>

            {activeFilterCount > 0 && (
              <button className="filter-clear-all" onClick={clearAllFilters}>
                <X size={14} />
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading uploads...</p>
          </div>
        ) : filteredUploads.length === 0 ? (
          <div className="empty-activity">
            <Upload size={48} />
            <h3>No Uploads Found</h3>
            <p>
              {activeFilterCount > 0
                ? 'Try adjusting your filters.'
                : 'Meter reading uploads from the mobile app will appear here.'}
            </p>
            {activeFilterCount > 0 && (
              <button className="filter-clear-all" onClick={clearAllFilters} style={{ marginTop: 8 }}>
                <X size={14} />
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="table-container">
            <table className="readings-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Source</th>
                  <th>Images</th>
                  <th>Prediction</th>
                  <th>Status</th>
                  <th>Date captured</th>
                  <th>Captured by</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredUploads.map((upload) => (
                  <tr key={upload.id} onClick={() => navigate(`/reading/${encodeURIComponent(upload.sessionId)}?workType=${workType}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="cell-with-icon">
                        <Upload size={14} className="cell-icon" />
                        <code>{upload.sessionId.slice(0, 12)}...</code>
                      </span>
                    </td>
                    <td>
                      <span className={`type-badge ${upload.sourceType}`}>
                        {upload.sourceType}
                      </span>
                    </td>
                    <td>
                      <span className="cell-with-icon">
                        <Image size={14} className="cell-icon" />
                        {upload.imageCount}
                      </span>
                    </td>
                    <td>
                      <span className="meter-value">{upload.prediction}</span>
                    </td>
                    <td>
                      <span className={`upload-status ${upload.status === 'correct' ? 'correct' : upload.status === 'not_sure' ? 'not-sure' : upload.status === 'no_dials' ? 'no-dials' : 'incorrect'}`}>
                        {upload.status === 'correct' ? (
                          <CheckCircle size={14} />
                        ) : upload.status === 'not_sure' ? (
                          <HelpCircle size={14} />
                        ) : upload.status === 'no_dials' ? (
                          <XCircle size={14} />
                        ) : (
                          <XCircle size={14} />
                        )}
                        <span className="upload-status-label">{uploadStatusLabel(upload.status)}</span>
                      </span>
                    </td>
                    <td>
                      <span className="cell-with-icon">
                        <Calendar size={14} className="cell-icon" />
                        {new Date(upload.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td>
                      <span className="cell-with-icon uploads-col-captured">
                        <User size={14} className="cell-icon" />
                        <span className="uploads-col-captured-text" title={upload.userEmail || undefined}>
                          {upload.userEmail?.trim() ? upload.userEmail : '—'}
                        </span>
                      </span>
                    </td>
                    <td>
                      <button className="table-view-btn" onClick={(e) => { e.stopPropagation(); navigate(`/reading/${encodeURIComponent(upload.sessionId)}?workType=${workType}`); }}>
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadsTable;
