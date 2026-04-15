import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import type { ReadingStatus } from '../types';
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
  Search,
  Upload,
  User,
  RefreshCw,
  Download,
  SlidersHorizontal,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react';

type OwnerFilter = 'all' | 'mine';
type SourceFilter = 'all' | 'field' | 'simulator';
type SortOption = 'newest' | 'oldest';

const ALL_STATUSES: ReadingStatus[] = [
  'correct',
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
  'no_dials',
  'not_sure',
];

const ReadingsList: React.FC = () => {
  const { status } = useParams<{ status: string }>();
  const navigate = useNavigate();
  const { getReadingsByStatus, bulkUpdateStatus, refreshData } = useReadings();
  const { userEmail } = useAuth();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<ReadingStatus>('incorrect_analyzed');
  const [isMoving, setIsMoving] = useState(false);

  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>(status as ReadingStatus | 'all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkedNames, setLinkedNames] = useState<string[]>([]);

  useEffect(() => {
    setStatusFilter(status as ReadingStatus | 'all');
  }, [status]);

  useEffect(() => {
    if (userEmail) {
      fetch(`/api/user-mappings?email=${encodeURIComponent(userEmail)}`)
        .then(r => r.ok ? r.json() : { names: [] })
        .then(data => setLinkedNames(data.names || []))
        .catch(() => {});
    }
  }, [userEmail]);

  const readings = getReadingsByStatus(statusFilter as ReadingStatus | 'all');

  const filteredReadings = useMemo(() => {
    let result = readings;

    if (ownerFilter === 'mine' && userEmail) {
      const emailLower = userEmail.toLowerCase();
      const namesLower = linkedNames.map(n => n.toLowerCase());
      result = result.filter(r => {
        const name = ((r as any).userName || '').toLowerCase();
        if (name.includes(emailLower)) return true;
        return namesLower.some(n => name === n);
      });
    }

    if (sourceFilter !== 'all') {
      result = result.filter(r => r.type === sourceFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        r.id.toLowerCase().includes(q) ||
        r.meterValue?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        ((r as any).userName || '').toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      const ta = new Date(a.dateOfReading).getTime();
      const tb = new Date(b.dateOfReading).getTime();
      return sortBy === 'newest' ? tb - ta : ta - tb;
    });

    return result;
  }, [readings, ownerFilter, sourceFilter, sortBy, searchQuery, userEmail, linkedNames]);

  const stats = useMemo(() => {
    const correct = filteredReadings.filter(r => r.status === 'correct').length;
    const incorrect = filteredReadings.filter(r => r.status.startsWith('incorrect')).length;
    const accuracy = filteredReadings.length > 0 ? ((correct / filteredReadings.length) * 100).toFixed(1) : '0';
    return { total: filteredReadings.length, correct, incorrect, accuracy };
  }, [filteredReadings]);

  const activeFilterCount = [
    ownerFilter !== 'all',
    sourceFilter !== 'all',
    statusFilter !== status,
    searchQuery.trim() !== '',
  ].filter(Boolean).length;

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
    if (statusFilter === 'all') return 'All Readings';
    return statusLabels[statusFilter as ReadingStatus] || 'Readings';
  };

  const getStatusColor = () => {
    if (statusFilter === 'all') return '#64748b';
    return statusColors[statusFilter as ReadingStatus] || '#64748b';
  };

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
    if (selectedIds.size === filteredReadings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredReadings.map(r => r.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const getAvailableStatuses = (): ReadingStatus[] => {
    return ALL_STATUSES.filter(s => s !== statusFilter);
  };

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

  const clearAllFilters = () => {
    setOwnerFilter('all');
    setSourceFilter('all');
    setStatusFilter(status as ReadingStatus | 'all');
    setSearchQuery('');
    setSortBy('newest');
  };

  const exportCSV = () => {
    const headers = ['ID', 'Date', 'User', 'Location', 'Type', 'Status', 'Meter Value'];
    const rows = filteredReadings.map(r => [
      r.id,
      new Date(r.dateOfReading).toISOString(),
      (r as any).userName || 'Unknown',
      r.location,
      r.type,
      statusLabels[r.status],
      r.meterValue,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `readings-${statusFilter}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isAllSelected = filteredReadings.length > 0 && selectedIds.size === filteredReadings.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredReadings.length;

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
              <p>{filteredReadings.length} reading{filteredReadings.length !== 1 ? 's' : ''} found</p>
            </div>
          </div>
        </div>
      </header>

      <main className="list-content">
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
            <div className="filter-chips">
              <button
                className={`filter-chip ${ownerFilter === 'all' ? 'active' : ''}`}
                onClick={() => setOwnerFilter('all')}
              >
                <Upload size={14} />
                All
              </button>
              <button
                className={`filter-chip ${ownerFilter === 'mine' ? 'active' : ''}`}
                onClick={() => setOwnerFilter('mine')}
              >
                <User size={14} />
                Mine
              </button>
            </div>

            <div className="filter-actions">
              <span className="uploads-count">{filteredReadings.length} result{filteredReadings.length !== 1 ? 's' : ''}</span>
              <button className="export-button" onClick={exportCSV} title="Export CSV" disabled={filteredReadings.length === 0}>
                <Download size={16} />
                <span>Export</span>
              </button>
              <button className="refresh-button" onClick={refreshData} title="Refresh">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="filter-row">
            {/* Status filter */}
            <div className="filter-group">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ReadingStatus | 'all')}
                className="filter-select"
              >
                <option value="all">All Statuses</option>
                {ALL_STATUSES.map(s => (
                  <option key={s} value={s}>{statusLabels[s]}</option>
                ))}
              </select>
            </div>

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
                placeholder="Search ID, value, location, user..."
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
                <th>User</th>
                <th>Location</th>
                <th>Type</th>
                <th>Status</th>
                <th>Meter Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReadings.map((reading) => (
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
                      <User size={14} className="cell-icon" />
                      <span>{(reading as any).userName || 'Unknown'}</span>
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
                  <td>
                    <button 
                      className="view-button"
                      onClick={() => navigate(`/reading/${reading.id}`)}
                      style={{ '--accent': getStatusColor() } as React.CSSProperties}
                    >
                      <Eye size={16} />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredReadings.length === 0 && (
            <div className="empty-state">
              {activeFilterCount > 0 ? (
                <>
                  <SlidersHorizontal size={48} />
                  <p>No readings match your filters.</p>
                  <button className="filter-clear-all" onClick={clearAllFilters} style={{ marginTop: 8 }}>
                    <X size={14} />
                    Clear filters
                  </button>
                </>
              ) : (
                <p>No readings found with this status.</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ReadingsList;
