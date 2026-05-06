import { useState, useEffect, useMemo, useCallback, useRef, type FC } from 'react';
import { useParams, useNavigate, useSearchParams, useOutletContext, useLocation } from 'react-router-dom';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import type { WorkType, MeterImage } from '../types';
import type { ReadingStatus } from '../types';
import {
  statusLabels,
  statusColors,
  INCORRECT_PIPELINE_STATUSES,
  labelerPipelineStatusLabels,
  isIncorrectPipelineStatus,
} from '../types';
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
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ArrowDown,
} from 'lucide-react';
import {
  fetchReadingById,
  downloadSessionRetrainZip,
  patchSessionMetadata,
  type SessionMetadataPatch,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';

const PORTAL_WORK_TYPES: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

export type ReadingDetailLocationState = {
  readingQueueIds?: string[];
};

function statusIsIncorrect(status: ReadingStatus): boolean {
  return status.startsWith('incorrect');
}

/** Synthetic `<select>` value so any incorrect_* maps to one "Incorrect" row for reviewers. */
const REVIEWER_SELECT_INCORRECT = '__incorrect__' as const;

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

type DialDetailRow = NonNullable<S3MeterReading['dialDetails']>[number];

/** When `metadata.json` has no `dial_details`, still give reviewers one row per dial crop (digits from model reading). */
function dialRowsFromDialCropImages(
  images: MeterImage[],
  meterValue: string | number | null | undefined,
): DialDetailRow[] {
  const sorted = images
    .filter(isDialCropImage)
    .sort((a, b) => (a.metadata.dialIndex ?? 0) - (b.metadata.dialIndex ?? 0));
  const mv = meterValue != null ? String(meterValue) : '';
  return sorted.map((img) => {
    const pos = img.metadata.dialIndex ?? 0;
    const ch = mv[pos];
    let prediction = 0;
    if (ch !== undefined && ch !== '' && /\d/.test(ch)) {
      prediction = parseInt(ch, 10);
    }
    return {
      dial: pos + 1,
      prediction,
      direction: 'clockwise',
      confidence: 0,
    };
  });
}

/** Baseline dial editor rows from the server session (explicit dial_details or inferred from dial images). */
function baselineDialRowsForReading(reading: S3MeterReading): DialDetailRow[] {
  if (reading.dialDetails && reading.dialDetails.length > 0) {
    return reading.dialDetails.map((d) => ({
      dial: d.dial,
      prediction: d.prediction,
      direction: d.direction,
      confidence: d.confidence,
    }));
  }
  return dialRowsFromDialCropImages(reading.images, reading.meterValue);
}

function dialCropImageForDial(dialImages: MeterImage[], dialNumber: number): MeterImage | undefined {
  return dialImages.find(
    (img) => typeof img.metadata.dialIndex === 'number' && img.metadata.dialIndex + 1 === dialNumber,
  );
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { getReadingById, updateReadingStatus, updateReadingComments, refreshData, workType: contextWorkType } =
    useReadings();
  const { userEmail } = useAuth();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const isLabelerMode = portalWorkMode === 'labeler';

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

  const readingQueueIds = useMemo(() => {
    const st = location.state as ReadingDetailLocationState | null;
    return Array.isArray(st?.readingQueueIds) && st.readingQueueIds.length > 0 ? st.readingQueueIds : undefined;
  }, [location.state]);

  const queueIndex = useMemo(() => {
    if (!reading?.id || !readingQueueIds?.length) return -1;
    const ix = readingQueueIds.indexOf(reading.id);
    return ix;
  }, [reading?.id, readingQueueIds]);

  const reviewerCorrectionsRef = useRef<HTMLDivElement | null>(null);
  const [incorrectOutcomeIntroOpen, setIncorrectOutcomeIntroOpen] = useState(false);

  const [mlPrediction, setMlPrediction] = useState('');
  const [userCorrection, setUserCorrection] = useState('');
  const [localDialRows, setLocalDialRows] = useState<DialDetailRow[]>([]);

  const effectiveReading = useMemo((): S3MeterReading | null => {
    if (!reading) return null;
    if (isLabelerMode) return reading;
    return {
      ...reading,
      dialDetails: localDialRows.length > 0 ? localDialRows : reading.dialDetails,
      expectedValue: userCorrection || undefined,
      meterValue: mlPrediction,
    };
  }, [reading, isLabelerMode, localDialRows, userCorrection, mlPrediction]);

  const imagePartition = useMemo(
    () =>
      effectiveReading
        ? partitionMeterImages(effectiveReading.images)
        : { fullMeter: undefined as MeterImage | undefined, dialImages: [] as MeterImage[], otherImages: [] as MeterImage[] },
    [effectiveReading],
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
    if (!reading) return;
    setComments(reading.comments || '');
    setSelectedStatus(reading.status);
    setMlPrediction(reading.meterValue != null ? String(reading.meterValue) : '');
    setUserCorrection(reading.expectedValue != null ? String(reading.expectedValue) : '');
    setLocalDialRows(baselineDialRowsForReading(reading).map((d) => ({ ...d })));
  }, [
    reading?.id,
    reading?.status,
    reading?.s3SessionPrefix,
    reading?.meterValue,
    reading?.expectedValue,
    reading?.comments,
    reading?.dialDetails,
  ]);

  const isDirty = useMemo(() => {
    const r = directReading || contextReading;
    if (!r) return false;
    if (isLabelerMode) {
      return selectedStatus !== r.status;
    }
    const baseExpected = r.expectedValue != null ? String(r.expectedValue) : '';
    const baseMeter = r.meterValue != null ? String(r.meterValue) : '';
    const baseComments = r.comments || '';
    const baseDialStr = JSON.stringify(baselineDialRowsForReading(r));
    const newDialStr = JSON.stringify(localDialRows);
    return (
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr ||
      comments !== baseComments ||
      selectedStatus !== r.status
    );
  }, [
    isLabelerMode,
    directReading,
    contextReading,
    userCorrection,
    mlPrediction,
    localDialRows,
    comments,
    selectedStatus,
  ]);

  const performSaveAction = useCallback(async (): Promise<boolean> => {
    const r = directReading || contextReading;
    if (!r?.s3SessionPrefix) {
      alert(
        isLabelerMode
          ? 'Missing S3 session prefix; cannot move this session.'
          : 'Missing S3 session prefix; cannot save metadata.',
      );
      return false;
    }

    if (isLabelerMode) {
      if (selectedStatus === r.status) return true;
      if (!isIncorrectPipelineStatus(r.status)) {
        alert(
          'This session is not in the labeling pipeline yet. Switch to reviewer mode to set Correct, Incorrect, No dials, or Not sure.',
        );
        return false;
      }
      if (!isIncorrectPipelineStatus(selectedStatus)) {
        alert('Choose a pipeline stage (new → analyzed → labeled → added to training dataset).');
        return false;
      }

      setIsSaving(true);
      try {
        await updateReadingStatus(r.id, selectedStatus, r);
        const latest = await fetchReadingById(r.id, workTypeForApi);
        if (latest) {
          setDirectReading(latest);
          updateReadingComments(latest.id, latest.comments || '');
          setSelectedStatus(latest.status);
        }
        await refreshData();
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
        return true;
      } catch (error) {
        console.error('Failed to save pipeline stage:', error);
        alert(error instanceof Error ? error.message : 'Save failed.');
        return false;
      } finally {
        setIsSaving(false);
      }
    }

    const snapshotForMove = r;
    const baseExpected = r.expectedValue != null ? String(r.expectedValue) : '';
    const baseMeter = r.meterValue != null ? String(r.meterValue) : '';
    const baseComments = r.comments || '';
    const baseDialStr = JSON.stringify(baselineDialRowsForReading(r));
    const newDialStr = JSON.stringify(localDialRows);

    const metaDirty =
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr ||
      comments !== baseComments;

    setIsSaving(true);
    try {
      if (metaDirty) {
        const patch: SessionMetadataPatch = {
          ml_prediction: mlPrediction,
          user_correction: userCorrection,
          portal_review_notes: comments,
        };
        const hadDialDetails = (r.dialDetails?.length ?? 0) > 0;
        if (localDialRows.length > 0) {
          patch.dial_details = localDialRows.map((row) => ({
            dial: Math.round(Number(row.dial)) || 1,
            prediction: Number(row.prediction),
            direction: String(row.direction || 'clockwise').slice(0, 40),
            confidence: Math.min(1, Math.max(0, Number(row.confidence))),
          }));
        } else if (hadDialDetails) {
          patch.dial_details = [];
        }

        const fresh = await patchSessionMetadata(
          r.id,
          workTypeForApi,
          { s3SessionPrefix: r.s3SessionPrefix, patch },
          userEmail || undefined,
          'reviewer',
        );
        setDirectReading(fresh);
      }

      if (selectedStatus !== snapshotForMove.status) {
        await updateReadingStatus(snapshotForMove.id, selectedStatus, snapshotForMove);
      }

      const latest = await fetchReadingById(r.id, workTypeForApi);
      if (latest) {
        setDirectReading(latest);
        updateReadingComments(latest.id, latest.comments || '');
        setSelectedStatus(latest.status);
      }

      await refreshData();
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
      return true;
    } catch (error) {
      console.error('Failed to save:', error);
      alert(error instanceof Error ? error.message : 'Save failed.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    isLabelerMode,
    directReading,
    contextReading,
    userCorrection,
    mlPrediction,
    localDialRows,
    comments,
    selectedStatus,
    workTypeForApi,
    userEmail,
    updateReadingStatus,
    updateReadingComments,
    refreshData,
  ]);

  const handleSave = useCallback(() => {
    void performSaveAction();
  }, [performSaveAction]);

  const canQueuePrev = queueIndex > 0;
  const canQueueNext = Boolean(
    readingQueueIds?.length && queueIndex >= 0 && queueIndex < readingQueueIds.length - 1,
  );

  const navigateQueue = useCallback(
    (delta: -1 | 1) => {
      if (!readingQueueIds?.length || queueIndex < 0) return;
      const nextIdx = queueIndex + delta;
      if (nextIdx < 0 || nextIdx >= readingQueueIds.length) return;
      const nextId = readingQueueIds[nextIdx];
      const qs = searchParams.toString();
      navigate(
        {
          pathname: `/reading/${encodeURIComponent(nextId)}`,
          search: qs ? `?${qs}` : '',
        },
        { state: { readingQueueIds } },
      );
    },
    [readingQueueIds, queueIndex, searchParams, navigate],
  );

  const saveAndGoNext = useCallback(async () => {
    const ok = await performSaveAction();
    if (ok && readingQueueIds?.length && queueIndex >= 0 && queueIndex < readingQueueIds.length - 1) {
      const nextId = readingQueueIds[queueIndex + 1];
      const qs = searchParams.toString();
      navigate(
        {
          pathname: `/reading/${encodeURIComponent(nextId)}`,
          search: qs ? `?${qs}` : '',
        },
        { state: { readingQueueIds } },
      );
    }
  }, [performSaveAction, readingQueueIds, queueIndex, searchParams, navigate]);

  const rNow = directReading || contextReading;
  const incorrectContext = (() => {
    if (!rNow) return false;
    return statusIsIncorrect(selectedStatus) || statusIsIncorrect(rNow.status);
  })();
  /** Reviewer incorrect flow: corrections + queue nav live in the main column (no modal). */
  const inlineIncorrectReview = incorrectContext && !isLabelerMode;

  useEffect(() => {
    if (!incorrectContext) setIncorrectOutcomeIntroOpen(false);
  }, [incorrectContext]);

  const scrollToReviewerCorrections = useCallback(() => {
    setIncorrectOutcomeIntroOpen(false);
    requestAnimationFrame(() => {
      const el = reviewerCorrectionsRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.focus();
    });
  }, []);

  useEffect(() => {
    if (!inlineIncorrectReview) return;
    const onKey = (e: KeyboardEvent) => {
      if (isSaving) return;
      const el = e.target as HTMLElement | null;
      const inField = Boolean(el?.closest('input, textarea, select'));
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void performSaveAction();
        return;
      }
      if (inField && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'n' || e.key === 'N' || e.key === 'p' || e.key === 'P') return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        if (canQueuePrev) {
          e.preventDefault();
          navigateQueue(-1);
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        if (canQueueNext) {
          e.preventDefault();
          navigateQueue(1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inlineIncorrectReview, isSaving, canQueuePrev, canQueueNext, navigateQueue, performSaveAction]);

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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
        {!isLabelerMode && incorrectContext ? (
          <div className="reading-detail-corrections-dock" role="region" aria-label="Reviewer corrections shortcut">
            <button type="button" className="reading-detail-corrections-dock-btn" onClick={() => scrollToReviewerCorrections()}>
              <ClipboardList size={18} aria-hidden />
              <span>Jump to corrections</span>
              <ArrowDown size={16} aria-hidden />
            </button>
            <span className="reading-detail-corrections-dock-hint">
              Update dial values and readings—section is below the images.
            </span>
          </div>
        ) : null}
      </header>

      <main className="detail-content">
        <div className="reading-detail-layout">
          <div className="reading-detail-primary">
            {isLabelerMode ? (
              <p className="reading-detail-readonly-banner" role="status">
                Inspect images here. Use the sidebar to move sessions between pipeline stages (new → analyzed → labeled
                → training). Dial values, notes, and outcome (correct / incorrect / no dials / not sure) are edited in{' '}
                <strong>reviewer</strong> mode.
              </p>
            ) : null}
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
                      reading={effectiveReading!}
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
                      reading={effectiveReading!}
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
                        reading={effectiveReading!}
                        selectedImage={selectedImage}
                        onActivate={handleImageActivate}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            {(hasS3Metadata || !isLabelerMode) && (
              <section className="ml-metrics-section reading-detail-ml">
                <h2>
                  <Zap size={20} /> Reading check
                </h2>
                {hasS3Metadata ? (
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
                        <div className="metric-label">Dials detected</div>
                      </div>
                    )}
                  </div>
                ) : null}

                {!isLabelerMode && incorrectContext ? (
                  <div
                    ref={reviewerCorrectionsRef}
                    id="reading-detail-reviewer-corrections"
                    className="incorrect-review-inline"
                    tabIndex={-1}
                  >
                    <div className="incorrect-review-inline-head">
                      <h3 id="incorrect-review-inline-title">Incorrect reading — reviewer corrections</h3>
                      <p className="incorrect-review-subid">
                        {readingQueueIds?.length ? (
                          <>
                            {queueIndex >= 0 ? (
                              <span>
                                {queueIndex + 1} of {readingQueueIds.length} in this list
                              </span>
                            ) : null}
                            {queueIndex >= 0 ? ' · ' : null}
                          </>
                        ) : null}
                        <code>{reading.id}</code>
                      </p>
                    </div>

                    <p className="reading-detail-reviewer-callout incorrect-review-callout" role="status">
                      This session is <strong>incorrect</strong>. Update dial values if the model was wrong, check the
                      whole-meter reading, then <strong>Save changes</strong> in the sidebar (or Save here). Use{' '}
                      <strong>Next</strong> / <strong>Previous</strong> to move through the same list order as the
                      readings table.
                    </p>

                    <div className="incorrect-review-body">
                      <div className="reading-detail-metadata-fields">
                        <label className="reading-detail-meta-field" htmlFor="rd-ml-pred-incorrect">
                          <span>Reading from model</span>
                          <input
                            id="rd-ml-pred-incorrect"
                            className="reading-detail-meta-input"
                            value={mlPrediction}
                            onChange={(e) => setMlPrediction(e.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <label className="reading-detail-meta-field" htmlFor="rd-user-corr-incorrect">
                          <span>Correct reading (whole meter)</span>
                          <input
                            id="rd-user-corr-incorrect"
                            className="reading-detail-meta-input"
                            value={userCorrection}
                            onChange={(e) => setUserCorrection(e.target.value)}
                            placeholder="What the dials should read overall"
                            autoComplete="off"
                          />
                        </label>
                      </div>

                      {localDialRows.length > 0 ? (
                        <div className="incorrect-review-dials">
                          <h4 className="reading-detail-dial-simple-title">Dial crops and values</h4>
                          <p className="reading-detail-field-hint incorrect-review-dials-hint">
                            Match each crop to the dial position, then set the digit. Click an image to enlarge.
                          </p>
                          <div className="incorrect-review-dial-grid">
                            {localDialRows.map((dial, idx) => {
                              const dialImg = dialCropImageForDial(dialImages, dial.dial);
                              return (
                                <div key={`${dial.dial}-${idx}`} className="incorrect-review-dial-cell">
                                  {dialImg ? (
                                    <button
                                      type="button"
                                      className="incorrect-review-dial-thumb"
                                      onClick={() => handleImageActivate(dialImg.id)}
                                      title="Open dial image"
                                      aria-label={`Open dial ${dial.dial} image larger`}
                                    >
                                      <img src={dialImg.url} alt="" loading="lazy" />
                                    </button>
                                  ) : (
                                    <div
                                      className="incorrect-review-dial-thumb incorrect-review-dial-thumb--empty"
                                      aria-hidden
                                      title="No matching dial crop in this session"
                                    />
                                  )}
                                  <label className="incorrect-review-dial-fields">
                                    <span className="incorrect-review-dial-label">Dial {dial.dial}</span>
                                    <input
                                      type="number"
                                      step="any"
                                      className="reading-detail-dial-input reading-detail-dial-input--value"
                                      aria-label={`Correct value for dial ${dial.dial}`}
                                      value={dial.prediction}
                                      onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        setLocalDialRows((rows) =>
                                          rows.map((row, i) =>
                                            i === idx
                                              ? { ...row, prediction: Number.isFinite(v) ? v : row.prediction }
                                              : row,
                                          ),
                                        );
                                      }}
                                    />
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="reading-detail-field-hint reading-detail-field-hint--solo">
                          No dial crops or per-dial data in this session—use <strong>Correct reading</strong> above.
                        </p>
                      )}
                    </div>

                    <div className="incorrect-review-footer">
                      <button
                        type="button"
                        className="incorrect-review-nav-btn"
                        disabled={!canQueuePrev || isSaving}
                        onClick={() => navigateQueue(-1)}
                      >
                        <ChevronLeft size={18} aria-hidden /> Previous
                      </button>
                      <button
                        type="button"
                        className="incorrect-review-save-btn"
                        disabled={isSaving}
                        onClick={() => void performSaveAction()}
                      >
                        {isSaving ? <Loader2 size={18} className="spin" /> : <Save size={18} />}
                        {isSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="incorrect-review-save-next-btn"
                        disabled={isSaving || !canQueueNext}
                        onClick={() => void saveAndGoNext()}
                      >
                        Save &amp; next
                      </button>
                      <button
                        type="button"
                        className="incorrect-review-nav-btn"
                        disabled={!canQueueNext || isSaving}
                        onClick={() => navigateQueue(1)}
                      >
                        Next <ChevronRight size={18} aria-hidden />
                      </button>
                    </div>
                    <p className="incorrect-review-kbd-hint">
                      <kbd>←</kbd> <kbd>P</kbd> previous · <kbd>→</kbd> <kbd>N</kbd> next ·{' '}
                      <kbd>{typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>
                      <kbd>Enter</kbd> save
                    </p>
                  </div>
                ) : null}

                {!isLabelerMode && !incorrectContext ? (
                  <div className="reading-detail-metadata-editor">
                    <h3 className="reading-detail-metadata-editor-title">Reviewer corrections</h3>
                    <p className="reading-detail-field-hint">
                      Includes sessions already marked <strong>correct</strong>: adjust values if needed, or change
                      status—then <strong>Save changes</strong> updates <code>metadata.json</code> (and moves the
                      session if you changed status).
                    </p>
                    <div className="reading-detail-metadata-fields">
                      <label className="reading-detail-meta-field" htmlFor="rd-ml-pred-inline">
                        <span>Reading from model</span>
                        <input
                          id="rd-ml-pred-inline"
                          className="reading-detail-meta-input"
                          value={mlPrediction}
                          onChange={(e) => setMlPrediction(e.target.value)}
                          autoComplete="off"
                        />
                      </label>
                      <label className="reading-detail-meta-field" htmlFor="rd-user-corr-inline">
                        <span>Correct reading (whole meter)</span>
                        <input
                          id="rd-user-corr-inline"
                          className="reading-detail-meta-input"
                          value={userCorrection}
                          onChange={(e) => setUserCorrection(e.target.value)}
                          placeholder="What the dials should read overall"
                          autoComplete="off"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {isLabelerMode && reading.dialDetails && reading.dialDetails.length > 0 ? (
                  <div className="dial-details">
                    <h3>Dial predictions</h3>
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
                ) : null}
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

              {isLabelerMode ? (
                <div className="reading-detail-viewonly">
                  {isIncorrectPipelineStatus(reading.status) ? (
                    <>
                      <div className="status-control">
                        <label htmlFor="reading-detail-labeler-pipeline">Pipeline stage</label>
                        <select
                          id="reading-detail-labeler-pipeline"
                          value={selectedStatus}
                          onChange={(e) => {
                            setSelectedStatus(e.target.value as ReadingStatus);
                          }}
                          style={{
                            borderColor: statusColors[selectedStatus],
                            backgroundColor: `${statusColors[selectedStatus]}10`,
                          }}
                          aria-describedby="reading-detail-labeler-pipeline-hint"
                        >
                          {INCORRECT_PIPELINE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {labelerPipelineStatusLabels[s as keyof typeof labelerPipelineStatusLabels]}
                            </option>
                          ))}
                        </select>
                        <p id="reading-detail-labeler-pipeline-hint" className="reading-detail-field-hint">
                          Moves the session folder between incorrect queues. Outcomes (correct / incorrect / no dials /
                          not sure) are set in reviewer mode.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`save-button ${isSaved ? 'saved' : ''} ${isSaving ? 'saving' : ''}`}
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        aria-busy={isSaving}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 size={18} className="spin" aria-hidden />
                            <span>Saving…</span>
                          </>
                        ) : isSaved ? (
                          <>
                            <Check size={18} aria-hidden />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Save size={18} aria-hidden />
                            <span>Save pipeline stage</span>
                          </>
                        )}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="reading-detail-viewonly-folder">
                        <span className="reading-detail-viewonly-label">folder</span>{' '}
                        <span
                          className="reading-detail-status-pill"
                          style={{
                            borderColor: statusColors[reading.status],
                            color: statusColors[reading.status],
                            backgroundColor: `${statusColors[reading.status]}14`,
                          }}
                        >
                          {statusLabels[reading.status]}
                        </span>
                      </p>
                      <p className="reading-detail-field-hint">
                        Pipeline moves apply only to sessions already in an incorrect queue. Switch the sidebar to{' '}
                        <strong>reviewer</strong> to set correct, incorrect, no dials, or not sure.
                      </p>
                    </>
                  )}
                  {reading.comments ? (
                    <div className="reading-detail-comments-readonly">
                      <span className="reading-detail-viewonly-label">note</span>
                      <p>{reading.comments}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="status-control">
                    <label htmlFor="reading-detail-status">Outcome</label>
                    <select
                      id="reading-detail-status"
                      value={statusIsIncorrect(selectedStatus) ? REVIEWER_SELECT_INCORRECT : selectedStatus}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === REVIEWER_SELECT_INCORRECT) {
                          if (!statusIsIncorrect(selectedStatus)) {
                            setSelectedStatus('incorrect_new');
                            setIncorrectOutcomeIntroOpen(true);
                          } else {
                            setSelectedStatus((prev) => (statusIsIncorrect(prev) ? prev : 'incorrect_new'));
                          }
                        } else {
                          setSelectedStatus(raw as ReadingStatus);
                        }
                      }}
                      style={{
                        borderColor: statusColors[selectedStatus],
                        backgroundColor: `${statusColors[selectedStatus]}10`,
                      }}
                      aria-describedby="reading-detail-status-hint"
                    >
                      <option value="correct">{statusLabels.correct}</option>
                      <option value={REVIEWER_SELECT_INCORRECT}>Incorrect</option>
                      <option value="no_dials">{statusLabels.no_dials}</option>
                      <option value="not_sure">{statusLabels.not_sure}</option>
                    </select>
                    <p id="reading-detail-status-hint" className="reading-detail-field-hint">
                      Save writes reviewer fixes to <code>metadata.json</code> first, then moves the folder if you
                      changed status. Incorrect pipeline stages (analyzed, labeled, training) are adjusted in labeler
                      mode.
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
                    <p id="reading-detail-comments-hint" className="reading-detail-field-hint">
                      Saved to S3 as <code>portal_review_notes</code> when you save.
                    </p>
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
                        <span>Saving to S3…</span>
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
                </>
              )}
            </section>

            <section
              className="metadata-section"
              aria-labelledby="reading-detail-metadata-heading"
            >
              <h2 id="reading-detail-metadata-heading">
                <Info size={20} aria-hidden /> Reading information
                {isLabelerMode ? <span className="reading-detail-readonly-tag"> read-only</span> : null}
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
                  <span className="value meter-value-large">{effectiveReading?.meterValue ?? reading.meterValue}</span>
                </div>
                {(effectiveReading?.rawPrediction || reading.rawPrediction) && (
                  <div className="metadata-item">
                    <span className="label">Raw prediction</span>
                    <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                      {effectiveReading?.rawPrediction ?? reading.rawPrediction}
                    </span>
                  </div>
                )}
                {(effectiveReading?.expectedValue || reading.expectedValue) && (
                  <div className="metadata-item">
                    <span className="label">User correction</span>
                    <span className="value expected-value">
                      {effectiveReading?.expectedValue ?? reading.expectedValue}
                    </span>
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

      {!isLabelerMode && incorrectOutcomeIntroOpen ? (
        <div
          className="reading-detail-outcome-intro-overlay"
          role="presentation"
          onClick={() => setIncorrectOutcomeIntroOpen(false)}
        >
          <div
            className="reading-detail-outcome-intro-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-detail-outcome-intro-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reading-detail-outcome-intro-title">Marked incorrect</h2>
            <p>
              Update the <strong>model reading</strong>, <strong>whole-meter correction</strong>, and any{' '}
              <strong>dial values</strong> if needed, then use <strong>Save changes</strong> in the sidebar (or{' '}
              <strong>Save</strong> in the corrections block). The form is below the images—you can open it from the
              bar under the header too.
            </p>
            <div className="reading-detail-outcome-intro-actions">
              <button type="button" className="reading-detail-outcome-intro-primary" onClick={() => scrollToReviewerCorrections()}>
                Go to corrections
              </button>
              <button type="button" className="reading-detail-outcome-intro-secondary" onClick={() => setIncorrectOutcomeIntroOpen(false)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
