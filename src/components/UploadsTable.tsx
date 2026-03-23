import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Gauge,
  Upload,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Image,
  Calendar,
  User,
  Filter,
  RefreshCw,
} from 'lucide-react';

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

const UploadsTable: React.FC = () => {
  const navigate = useNavigate();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');

  useEffect(() => {
    const loadUploads = async () => {
      try {
        const response = await fetch('/api/uploads');
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

    loadUploads();
  }, []);

  const filteredUploads = uploads
    .filter(u => filterSource === 'all' || u.sourceType === filterSource)
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

  const refreshUploads = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/uploads');
      if (response.ok) {
        const data = await response.json();
        setUploads(data);
      }
    } catch {
      // keep existing data
    } finally {
      setLoading(false);
    }
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
              <h1>All Uploads</h1>
              <p>Track all meter reading submissions</p>
            </div>
          </div>
        </div>
      </header>

      <div className="uploads-content">
        <div className="uploads-toolbar">
          <div className="toolbar-left">
            <div className="uploads-filter">
              <Filter size={16} />
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="all">All Sources</option>
                <option value="field">Field</option>
                <option value="simulator">Simulator</option>
              </select>
            </div>
            <div className="uploads-sort">
              <Calendar size={16} />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>
          </div>
          <div className="toolbar-right">
            <span className="uploads-count">{filteredUploads.length} uploads</span>
            <button className="refresh-button" onClick={refreshUploads}>
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading uploads...</p>
          </div>
        ) : filteredUploads.length === 0 ? (
          <div className="empty-activity">
            <Upload size={48} />
            <h3>No Uploads Found</h3>
            <p>Meter reading uploads from the mobile app will appear here.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="readings-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Date</th>
                  <th>User</th>
                  <th>Source</th>
                  <th>Images</th>
                  <th>Prediction</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredUploads.map((upload) => (
                  <tr key={upload.id}>
                    <td>
                      <span className="cell-with-icon">
                        <Upload size={14} className="cell-icon" />
                        <code>{upload.sessionId.slice(0, 12)}...</code>
                      </span>
                    </td>
                    <td>
                      <span className="cell-with-icon">
                        <Clock size={14} className="cell-icon" />
                        {new Date(upload.timestamp).toLocaleDateString()}
                      </span>
                    </td>
                    <td>
                      <span className="cell-with-icon">
                        <User size={14} className="cell-icon" />
                        {upload.userEmail || 'Unknown'}
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
                      {upload.isCorrect ? (
                        <span className="upload-status correct">
                          <CheckCircle size={14} />
                          Correct
                        </span>
                      ) : (
                        <span className="upload-status incorrect">
                          <XCircle size={14} />
                          Incorrect
                        </span>
                      )}
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
