import { useState, useEffect, useMemo, useCallback, type FC } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import type { WorkType, MeterImage } from '../types';
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
  Loader2,
  Download,
  Maximize2,
} from 'lucide-react';
import { fetchReadingById, downloadSessionRetrainZip } from '../services/api';

const PORTAL_WORK_TYPES: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

function isDialCropImage(image: MeterImage): boolean {
  return typeof image.metadata.dialIndex === 'number';
}

function isFullMeterImage(image: MeterImage): boolean {
  if (isDialCropImage(image)) return false;
  const fn = (image.fileName || '').toLowerCase();
  if (fn.endsWith('original.jpg') || fn === 'original.jpg') return true;
  if (/full\s*meter/i.test(image.label)) return true;
  if (/^original/i.test(image.label.trim()) && !/dial/i.test(image.label)) return true;
  return false;
}

function partitionMeterImages(images: MeterImage[]): {
  fullMeter: MeterImage | undefined;
  dialImages: MeterImage[];
  otherImages: MeterImage[];
} {
  const dialImages = images
    .filter(isDialCropImage)
    .sort((a, b) => (a.metadata.dialIndex ?? 0) - (b.metadata.dialIndex ?? 0));

  const fullMeter =
    images.find(isFullMeterImage) ?? images.find((img) => !isDialCropImage(img));

  const claimed = new Set<string>([
    ...(fullMeter ? [fullMeter.id] : []),
    ...dialImages.map((d) => d.id),
  ]);
  const otherImages = images.filter((img) => !claimed.has(img.id));

  return { fullMeter, dialImages, otherImages };
}

type ReadingDetailImageCardProps = {
  image: MeterImage;
  reading: S3MeterReading;
  selectedImage: string | null;
  onActivate: (imageId: string) => void;
  strip?: boolean;
};

const ReadingDetailImageCard: FC<ReadingDetailImageCardProps> = ({
  image,
  reading,
  selectedImage,
  onActivate,
  strip,
}) => {
  const dialDetail =
    image.metadata.dialIndex !== undefined && reading.dialDetails
      ? reading.dialDetails.find((d) => d.dial === (image.metadata.dialIndex! + 1))
      : undefined;

  const expectedDigits = reading.expectedValue?.split('') || [];
  const predictedDigits = reading.meterValue?.split('') || [];
  const dialPosition = image.metadata.dialIndex;
  const expectedDigit = dialPosition !== undefined ? expectedDigits[dialPosition] : undefined;
  const predictedDigit = dialPosition !== undefined ? predictedDigits[dialPosition] : undefined;

  const isSelected = selectedImage === image.id;

  return (
    <div
      role="button"
      tabIndex={0}
      className={['image-card', isSelected ? 'selected' : '', strip ? 'image-card--dial-strip' : '']
        .filter(Boolean)
        .join(' ')}
      onClick={() => onActivate(image.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate(image.id);
        }
      }}
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
            <span className="meta-label">Dial index:</span>
            <span className="meta-value">{image.metadata.dialIndex}</span>
          </div>
        )}
      </div>

      {dialDetail && (
        <div className="dial-prediction-display">
          <div className="prediction-row">
            <span className="prediction-label">Predicted:</span>
            <span className="prediction-number">{dialDetail.prediction}</span>
          </div>
          {reading.expectedValue &&
            expectedDigit !== undefined &&
            expectedDigit !== predictedDigit && (
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
};

const ReadingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getReadingById, updateReadingStatus, updateReadingComments, workType: contextWorkType } = useReadings();

  const workTypeForApi = useMemo((): WorkType => {
    const q = searchParams.get('workType');
    if (q && PORTAL_WORK_TYPES.includes(q as WorkType)) return q as WorkType;
    return contextWorkType;
  }, [searchParams, contextWorkType]);

  const contextReading = getReadingById(id || '') as S3MeterReading | undefined;
  const [directReading, setDirectReading] = useState<S3MeterReading | null>(null);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const reading = directReading || contextReading;

  const imagePartition = useMemo(
    () =>
      reading
        ? partitionMeterImages(reading.images)
        : { fullMeter: undefined as MeterImage | undefined, dialImages: [] as MeterImage[], otherImages: [] as MeterImage[] },
    [reading],
  );

  const handleImageActivate = useCallback((imageId: string) => {
    setSelectedImage((prev) => (prev === imageId ? null : imageId));
  }, []);

  const [comments, setComments] = useState(reading?.comments || '');
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus>(
    reading?.status || 'incorrect_new'
  );
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [sessionZipExporting, setSessionZipExporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFetchLoading(true);
    setFetchError(false);

    fetchReadingById(id, workTypeForApi)
      .then((data) => {
        if (!cancelled) {
          if (data) {
            setDirectReading(data);
            setFetchError(false);
          } else {
            setDirectReading(null);
            setFetchError(true);
          }
        }
      })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setFetchLoading(false); });

    return () => { cancelled = true; };
  }, [id, workTypeForApi]);

  useEffect(() => {
    if (reading) {
      setComments(reading.comments);
      setSelectedStatus(reading.status);
    }
  }, [reading]);

  if (fetchLoading) {
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

  if (!reading) {
    return (
      <div className="detail-page">
        <div className="error-state">
          <p>{fetchError ? 'Reading not found' : 'No readings available'}</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  const handleDownloadSessionZip = async () => {
    if (!reading?.id) return;
    setSessionZipExporting(true);
    try {
      await downloadSessionRetrainZip(reading.id, workTypeForApi);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Failed to build session ZIP.');
    } finally {
      setSessionZipExporting(false);
    }
  };

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
    'incorrect_training',
    'no_dials',
    'not_sure',
  ];

  // Check if we have extended S3 metadata
  const hasS3Metadata = reading.confidence !== undefined || reading.dialDetails !== undefined;

  const { fullMeter, dialImages, otherImages } = imagePartition;
  const useDialStripLayout = dialImages.length > 0;

  return (
    <div className="detail-page">
      <header className="page-header">
        <div className="header-content reading-detail-header">
          <div className="reading-detail-header-lead">
            <button type="button" className="back-button" onClick={() => navigate(-1)}>
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
          <div className="reading-detail-header-actions">
            <button
              type="button"
              className="detail-download-zip-btn"
              onClick={handleDownloadSessionZip}
              disabled={sessionZipExporting}
              title="Download this session as a ZIP: all meter images plus metadata.json (same format as dashboard bulk export)."
            >
              {sessionZipExporting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Building ZIP…</span>
                </>
              ) : (
                <>
                  <Download size={18} />
                  <span>Download ZIP</span>
                </>
              )}
            </button>
            <span className="detail-download-zip-caption">
              {sessionZipExporting
                ? 'Packaging files from storage…'
                : 'All images + metadata.json for training or labeling'}
            </span>
          </div>
        </div>
      </header>

      <main className="detail-content">
        <div className="reading-detail-layout">
          <div className="reading-detail-primary">
            <section className="images-section">
              <div className="images-section-head">
                <h2>
                  <ImageIcon size={20} aria-hidden />
                  {useDialStripLayout ? 'Dial crops' : 'Captured images'}{' '}
                  <span className="images-section-count">
                    ({useDialStripLayout ? dialImages.length : reading.images.length})
                  </span>
                </h2>
                {fullMeter ? (
                  <button
                    type="button"
                    className="full-meter-view-btn"
                    onClick={() => handleImageActivate(fullMeter.id)}
                    title="Open uncropped full-meter photo in the viewer"
                  >
                    <Maximize2 size={18} aria-hidden />
                    <span>Full meter view</span>
                  </button>
                ) : null}
              </div>
              {fullMeter ? (
                <p className="images-section-lead">
                  Use <strong>Full meter view</strong> for the uncropped photo; the row below is per-dial model crops.
                </p>
              ) : null}

              {useDialStripLayout ? (
                <div
                  className="images-dial-row"
                  style={{ ['--dial-cols' as string]: String(Math.max(1, dialImages.length)) }}
                >
                  {dialImages.map((image) => (
                    <ReadingDetailImageCard
                      key={image.id}
                      image={image}
                      reading={reading}
                      selectedImage={selectedImage}
                      onActivate={handleImageActivate}
                      strip
                    />
                  ))}
                </div>
              ) : (
                <div className="images-grid">
                  {reading.images.map((image) => (
                    <ReadingDetailImageCard
                      key={image.id}
                      image={image}
                      reading={reading}
                      selectedImage={selectedImage}
                      onActivate={handleImageActivate}
                    />
                  ))}
                </div>
              )}

              {useDialStripLayout && otherImages.length > 0 ? (
                <>
                  <h3 className="images-section-subheading">Other images</h3>
                  <div className="images-grid images-grid--secondary">
                    {otherImages.map((image) => (
                      <ReadingDetailImageCard
                        key={image.id}
                        image={image}
                        reading={reading}
                        selectedImage={selectedImage}
                        onActivate={handleImageActivate}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            {hasS3Metadata && (
              <section className="ml-metrics-section reading-detail-ml">
                <h2>
                  <Zap size={20} /> ML Metrics
                </h2>
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
                                <RotateCw
                                  size={12}
                                  style={{
                                    transform:
                                      dial.direction === 'counterclockwise' ? 'scaleX(-1)' : 'none',
                                  }}
                                />
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
          </div>

          <aside className="reading-detail-sidebar" aria-label="Labeling and session details">
            <section
              className="status-section"
              aria-labelledby="reading-detail-status-heading"
            >
              <h2 id="reading-detail-status-heading">
                <FileText size={20} aria-hidden /> Status & Comments
              </h2>

              <div className="status-control">
                <label htmlFor="reading-detail-status">Change status</label>
                <select
                  id="reading-detail-status"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value as ReadingStatus)}
                  style={{
                    borderColor: statusColors[selectedStatus],
                    backgroundColor: `${statusColors[selectedStatus]}10`,
                  }}
                  aria-describedby="reading-detail-status-hint"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
                <p id="reading-detail-status-hint" className="reading-detail-field-hint">
                  Updates queue in storage when you save.
                </p>
              </div>

              <div className="comments-control">
                <label htmlFor="reading-detail-comments">Comments</label>
                <textarea
                  id="reading-detail-comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Add your comments here…"
                  rows={4}
                />
              </div>

              <button
                type="button"
                className={`save-button ${isSaved ? 'saved' : ''} ${isSaving ? 'saving' : ''}`}
                onClick={handleSave}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 size={18} className="spin" aria-hidden />
                    <span>Moving in S3…</span>
                  </>
                ) : isSaved ? (
                  <>
                    <Check size={18} aria-hidden />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <Save size={18} aria-hidden />
                    <span>Save changes</span>
                  </>
                )}
              </button>
            </section>

            <section
              className="metadata-section"
              aria-labelledby="reading-detail-metadata-heading"
            >
              <h2 id="reading-detail-metadata-heading">
                <Info size={20} aria-hidden /> Reading information
              </h2>
              <div className="metadata-grid">
                <div className="metadata-item">
                  <span className="label">
                    <Calendar size={16} aria-hidden /> Date of reading
                  </span>
                  <span className="value">{formatDate(reading.dateOfReading)}</span>
                </div>
                <div className="metadata-item">
                  <span className="label">
                    <MapPin size={16} aria-hidden /> Location
                  </span>
                  <span className="value">{reading.location}</span>
                </div>
                <div className="metadata-item">
                  <span className="label">
                    {reading.type === 'simulator' ? <Monitor size={16} aria-hidden /> : <Radio size={16} aria-hidden />}{' '}
                    Type
                  </span>
                  <span className={`type-badge ${reading.type}`}>
                    {reading.type === 'simulator' ? 'Simulator' : 'Field'}
                  </span>
                </div>
                <div className="metadata-item">
                  <span className="label">ML prediction</span>
                  <span className="value meter-value-large">{reading.meterValue}</span>
                </div>
                {reading.rawPrediction && (
                  <div className="metadata-item">
                    <span className="label">Raw prediction</span>
                    <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {reading.rawPrediction}
                    </span>
                  </div>
                )}
                {reading.expectedValue && (
                  <div className="metadata-item">
                    <span className="label">User correction</span>
                    <span className="value expected-value">{reading.expectedValue}</span>
                  </div>
                )}
                {reading.userName ? (
                  <div className="metadata-item">
                    <span className="label">Collector</span>
                    <span className="value">{reading.userName}</span>
                  </div>
                ) : null}
                {reading.workType ? (
                  <div className="metadata-item">
                    <span className="label">Work type (app)</span>
                    <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {reading.workType}
                    </span>
                  </div>
                ) : null}
                {reading.appVersion ? (
                  <div className="metadata-item">
                    <span className="label">App / model version</span>
                    <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {reading.appVersion}
                    </span>
                  </div>
                ) : null}
                {reading.feedbackType ? (
                  <div className="metadata-item">
                    <span className="label">Feedback type</span>
                    <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {reading.feedbackType}
                    </span>
                  </div>
                ) : null}
                {(reading.uploadMode || reading.imageSource) ? (
                  <div className="metadata-item">
                    <span className="label">Capture</span>
                    <span className="value">
                      {[reading.uploadMode, reading.imageSource].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* Lightbox */}
      {selectedImage ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setSelectedImage(null)}
        >
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={reading.images.find((i) => i.id === selectedImage)?.url}
              alt={reading.images.find((i) => i.id === selectedImage)?.label ?? 'Meter image'}
            />
            <button type="button" className="close-button" onClick={() => setSelectedImage(null)}>
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ReadingDetail;
