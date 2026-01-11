import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import type { ReadingStatus } from '../types';
import { statusLabels, statusColors } from '../types';
import type { S3MeterReading } from '../services/api';
import { 
  ArrowLeft, 
  MapPin, 
  Calendar,
  Monitor,
  Radio,
  Save,
  ImageIcon,
  FileText,
  Info,
  Gauge,
  Check,
  Zap,
  Target,
  Clock,
  RotateCw,
  Loader2
} from 'lucide-react';

const ReadingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getReadingById, updateReadingStatus, updateReadingComments, loading, readings } = useReadings();

  const reading = getReadingById(id || '') as S3MeterReading | undefined;
  const [comments, setComments] = useState(reading?.comments || '');
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus>(
    reading?.status || 'incorrect_new'
  );
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (reading) {
      setComments(reading.comments);
      setSelectedStatus(reading.status);
    }
  }, [reading]);

  // Show loading state while data is being fetched
  if (loading) {
    return (
      <div className="detail-page">
        <header className="page-header">
          <div className="header-content">
            <button className="back-button" onClick={() => navigate(-1)}>
              <ArrowLeft size={20} />
              <span>Back to List</span>
            </button>
            <div className="page-title">
              <Gauge size={32} strokeWidth={1.5} />
              <div>
                <h1>Reading Details</h1>
                <p>Loading...</p>
              </div>
            </div>
          </div>
        </header>
        <main className="detail-content">
          <div className="loading-state">
            <div className="spin" style={{ width: 48, height: 48, border: '3px solid var(--border-color)', borderTopColor: 'var(--accent-amber)', borderRadius: '50%' }}></div>
            <p>Loading reading data...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!reading && readings.length > 0) {
    return (
      <div className="detail-page">
        <div className="error-state">
          <p>Reading not found</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }
  
  if (!reading) {
    return (
      <div className="detail-page">
        <div className="error-state">
          <p>No readings available</p>
          <button onClick={() => navigate('/')}>Go to Dashboard</button>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update status (this also moves files in S3)
      await updateReadingStatus(reading.id, selectedStatus);
      // Update comments locally
      updateReadingComments(reading.id, comments);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to update status. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const statusOptions: ReadingStatus[] = [
    'correct',
    'incorrect_new',
    'incorrect_analyzed',
    'incorrect_labeled',
    'incorrect_training'
  ];

  // Check if we have extended S3 metadata
  const hasS3Metadata = reading.confidence !== undefined || reading.dialDetails !== undefined;

  return (
    <div className="detail-page">
      <header className="page-header">
        <div className="header-content">
          <button className="back-button" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
            <span>Back to List</span>
          </button>
          <div className="page-title">
            <Gauge size={32} strokeWidth={1.5} />
            <div>
              <h1>Reading Details</h1>
              <p>ID: {reading.id}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="detail-content">
        <div className="detail-grid">
          {/* Metadata Section */}
          <section className="metadata-section">
            <h2><Info size={20} /> Reading Information</h2>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="label">
                  <Calendar size={16} /> Date of Reading
                </span>
                <span className="value">{formatDate(reading.dateOfReading)}</span>
              </div>
              <div className="metadata-item">
                <span className="label">
                  <MapPin size={16} /> Location
                </span>
                <span className="value">{reading.location}</span>
              </div>
              <div className="metadata-item">
                <span className="label">
                  {reading.type === 'simulator' ? <Monitor size={16} /> : <Radio size={16} />} Type
                </span>
                <span className={`type-badge ${reading.type}`}>
                  {reading.type === 'simulator' ? 'Simulator' : 'Field'}
                </span>
              </div>
              <div className="metadata-item">
                <span className="label">ML Prediction</span>
                <span className="value meter-value-large">{reading.meterValue}</span>
              </div>
              {reading.rawPrediction && (
                <div className="metadata-item">
                  <span className="label">Raw Prediction</span>
                  <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>{reading.rawPrediction}</span>
                </div>
              )}
              {reading.expectedValue && (
                <div className="metadata-item">
                  <span className="label">User Correction</span>
                  <span className="value expected-value">{reading.expectedValue}</span>
                </div>
              )}
            </div>
          </section>

          {/* Status Control Section */}
          <section className="status-section">
            <h2><FileText size={20} /> Status & Comments</h2>
            
            <div className="status-control">
              <label>Change Status</label>
              <select 
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as ReadingStatus)}
                style={{ 
                  borderColor: statusColors[selectedStatus],
                  backgroundColor: `${statusColors[selectedStatus]}10`
                }}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="comments-control">
              <label>Comments</label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Add your comments here..."
                rows={4}
              />
            </div>

            <button 
              className={`save-button ${isSaved ? 'saved' : ''} ${isSaving ? 'saving' : ''}`}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Moving in S3...</span>
                </>
              ) : isSaved ? (
                <>
                  <Check size={18} />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </section>
        </div>

        {/* ML Metrics Section - Only shown for S3 data */}
        {hasS3Metadata && (
          <section className="ml-metrics-section">
            <h2><Zap size={20} /> ML Metrics</h2>
            <div className="metrics-grid">
              {reading.confidence !== undefined && (
                <div className="metric-card">
                  <Target size={24} />
                  <div className="metric-value">{(reading.confidence * 100).toFixed(1)}%</div>
                  <div className="metric-label">Confidence</div>
                </div>
              )}
              {reading.processingTimeMs !== undefined && (
                <div className="metric-card">
                  <Clock size={24} />
                  <div className="metric-value">{reading.processingTimeMs.toFixed(0)}ms</div>
                  <div className="metric-label">Processing Time</div>
                </div>
              )}
              {reading.dialCount !== undefined && (
                <div className="metric-card">
                  <Gauge size={24} />
                  <div className="metric-value">{reading.dialCount}</div>
                  <div className="metric-label">Dials Detected</div>
                </div>
              )}
            </div>

            {/* Dial Details Table */}
            {reading.dialDetails && reading.dialDetails.length > 0 && (
              <div className="dial-details">
                <h3>Dial Predictions</h3>
                <table className="dial-table">
                  <thead>
                    <tr>
                      <th>Dial</th>
                      <th>Prediction</th>
                      <th>Direction</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reading.dialDetails.map((dial) => (
                      <tr key={dial.dial}>
                        <td>Dial {dial.dial}</td>
                        <td className="prediction">{dial.prediction}</td>
                        <td>
                          <span className={`direction-badge ${dial.direction}`}>
                            <RotateCw size={12} style={{ 
                              transform: dial.direction === 'counterclockwise' ? 'scaleX(-1)' : 'none' 
                            }} />
                            {dial.direction === 'clockwise' ? 'CW' : 'CCW'}
                          </span>
                        </td>
                        <td>{(dial.confidence * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Images Section */}
        <section className="images-section">
          <h2><ImageIcon size={20} /> Captured Images ({reading.images.length})</h2>
          
          <div className="images-grid">
            {reading.images.map((image) => {
              // Find the dial detail for this image if it's a dial image
              const dialDetail = image.metadata.dialIndex !== undefined && reading.dialDetails
                ? reading.dialDetails.find(d => d.dial === (image.metadata.dialIndex! + 1))
                : undefined;
              
              // Parse expected value to get individual dial corrections
              const expectedDigits = reading.expectedValue?.split('') || [];
              const predictedDigits = reading.meterValue?.split('') || [];
              const dialPosition = image.metadata.dialIndex;
              const expectedDigit = dialPosition !== undefined ? expectedDigits[dialPosition] : undefined;
              const predictedDigit = dialPosition !== undefined ? predictedDigits[dialPosition] : undefined;
              
              return (
                <div 
                  key={image.id} 
                  className={`image-card ${selectedImage === image.id ? 'selected' : ''}`}
                  onClick={() => setSelectedImage(selectedImage === image.id ? null : image.id)}
                >
                  <div className="image-wrapper">
                    <img src={image.url} alt={image.label} loading="lazy" />
                    <div className="image-overlay">
                      <span className="image-label">{image.label}</span>
                    </div>
                  </div>
                  <div className="image-meta">
                    <div className="meta-row">
                      <span className="meta-label">Resolution:</span>
                      <span className="meta-value">{image.metadata.resolution}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Size:</span>
                      <span className="meta-value">{image.metadata.fileSize}</span>
                    </div>
                    {image.metadata.dialIndex !== undefined && (
                      <div className="meta-row">
                        <span className="meta-label">Dial Index:</span>
                        <span className="meta-value">{image.metadata.dialIndex}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Dial Prediction Display - Only for dial images */}
                  {dialDetail && (
                    <div className="dial-prediction-display">
                      <div className="prediction-row">
                        <span className="prediction-label">Predicted:</span>
                        <span className="prediction-number">{dialDetail.prediction}</span>
                      </div>
                      {reading.expectedValue && expectedDigit !== undefined && expectedDigit !== predictedDigit && (
                        <div className="prediction-row correct">
                          <span className="prediction-label">Correct:</span>
                          <span className="prediction-number correct">{expectedDigit}</span>
                        </div>
                      )}
                      <div className="prediction-confidence">
                        {(dialDetail.confidence * 100).toFixed(0)}% confidence
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Lightbox */}
      {selectedImage && (
        <div className="lightbox" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img 
              src={reading.images.find(i => i.id === selectedImage)?.url} 
              alt="Enlarged view" 
            />
            <button className="close-button" onClick={() => setSelectedImage(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingDetail;
