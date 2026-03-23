import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  Gauge,
  Upload,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Image,
  Eye,
  BarChart3,
} from 'lucide-react';

interface MyUploadEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  sourceType: string;
  workType: string;
  imageCount: number;
  prediction: string;
  isCorrect: boolean;
  status: string;
}

const MyUploads: React.FC = () => {
  const navigate = useNavigate();
  const { userEmail } = useAuth();
  const [uploads, setUploads] = useState<MyUploadEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMyUploads = async () => {
      try {
        const response = await fetch(`/api/uploads?email=${encodeURIComponent(userEmail || '')}`);
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

    loadMyUploads();
  }, [userEmail]);

  const correctCount = uploads.filter(u => u.isCorrect).length;
  const incorrectCount = uploads.filter(u => !u.isCorrect).length;
  const accuracy = uploads.length > 0 ? ((correctCount / uploads.length) * 100).toFixed(1) : '0';

  return (
    <div className="my-uploads-page">
      <header className="page-header">
        <div className="header-content">
          <button className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="page-title">
            <Gauge size={28} strokeWidth={1.5} />
            <div>
              <h1>My Uploads</h1>
              <p>{userEmail}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="my-uploads-content">
        <div className="my-uploads-stats">
          <div className="upload-stat-card">
            <Upload size={24} />
            <div className="upload-stat-value">{uploads.length}</div>
            <div className="upload-stat-label">Total Uploads</div>
          </div>
          <div className="upload-stat-card correct">
            <CheckCircle size={24} />
            <div className="upload-stat-value">{correctCount}</div>
            <div className="upload-stat-label">Correct</div>
          </div>
          <div className="upload-stat-card incorrect">
            <XCircle size={24} />
            <div className="upload-stat-value">{incorrectCount}</div>
            <div className="upload-stat-label">Incorrect</div>
          </div>
          <div className="upload-stat-card accuracy">
            <BarChart3 size={24} />
            <div className="upload-stat-value">{accuracy}%</div>
            <div className="upload-stat-label">Accuracy</div>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading your uploads...</p>
          </div>
        ) : uploads.length === 0 ? (
          <div className="empty-activity">
            <Upload size={48} />
            <h3>No Uploads Yet</h3>
            <p>Your meter reading submissions will appear here.</p>
          </div>
        ) : (
          <div className="my-uploads-grid">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="my-upload-card"
                onClick={() => navigate(`/reading/${upload.sessionId}`)}
              >
                <div className="my-upload-header">
                  <span className={`type-badge ${upload.sourceType}`}>
                    {upload.sourceType}
                  </span>
                  {upload.isCorrect ? (
                    <CheckCircle size={18} color="#10b981" />
                  ) : (
                    <XCircle size={18} color="#ef4444" />
                  )}
                </div>
                <div className="my-upload-prediction">
                  <span className="meter-value">{upload.prediction}</span>
                </div>
                <div className="my-upload-meta">
                  <span>
                    <Clock size={14} />
                    {new Date(upload.timestamp).toLocaleDateString()}
                  </span>
                  <span>
                    <Image size={14} />
                    {upload.imageCount} images
                  </span>
                </div>
                <button className="view-button">
                  <Eye size={14} />
                  View Details
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyUploads;
