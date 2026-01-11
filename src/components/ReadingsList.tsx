import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
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
  X
} from 'lucide-react';

const ReadingsList: React.FC = () => {
  const { status } = useParams<{ status: string }>();
  const navigate = useNavigate();
  const { getReadingsByStatus, bulkUpdateStatus } = useReadings();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<ReadingStatus>('incorrect_analyzed');
  const [isMoving, setIsMoving] = useState(false);

  const readings = getReadingsByStatus(status as ReadingStatus);

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
    return statusLabels[status as ReadingStatus] || 'Readings';
  };

  const getStatusColor = () => {
    if (status === 'all') return '#64748b';
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
      'incorrect_training'
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
              <p>{readings.length} reading{readings.length !== 1 ? 's' : ''} found</p>
            </div>
          </div>
        </div>
      </header>

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
                  <td>
                    <button 
                      className="view-button"
                      onClick={() => navigate(`/reading/${reading.id}`)}
                      style={{ '--accent': getStatusColor() } as React.CSSProperties}
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
              <p>No readings found with this status.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ReadingsList;
