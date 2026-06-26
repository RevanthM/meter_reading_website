import { useState, useEffect, useMemo, useCallback, useRef, type FC } from 'react';
import { createPortal } from 'react-dom';
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
  initialReviewerOutcomeStatus,
  resolveReviewerSaveStatus,
  statusIsIncorrect,
} from '../types';
import { buildTargetSessionPrefixFromSource } from '../utils/s3SessionPrefix';
import {
  concatDialDigitsFromRows,
  reconcileDialRowsForReading,
  reconcileModelDialRowsForReading,
} from '../utils/dialDetails';
import { fieldTestPredictedReading } from '../utils/fieldTestDisplay';
import {
  isFieldTestPortalReading,
  normalizePortalManualReviewStatus,
  portalManualReviewBadge,
} from '../utils/portalManualReview';
import { formatPortalAccuracyConfidencePctFromFraction } from '../utils/portalMetricFormat';
import type { DialDetailFromMetadata, DialPoint, S3MeterReading } from '../services/api';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Monitor,
  Radio,
  Save,
  ImageIcon,
  FileText,
  Gauge,
  Check,
  Zap,
  Target,
  Clock,
  RotateCw,
  Compass,
  Loader2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Pencil,
  XCircle,
  Maximize2,
} from 'lucide-react';
import {
  approveSessionForUnitTest,
  fetchReadingById,
  patchSessionMetadata,
  removeSessionFromTestDataset,
  type ImageDifficulty,
  type ReviewerDatasetDestination,
  type SessionMetadataPatch,
} from '../services/api';
import MeterPhotosLightbox, { type MeterPhotoSlide } from './MeterPhotosLightbox';
import SessionActivitySection from './SessionActivitySection';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { formatReadingShortDate } from '../utils/readingDisplayDates';
import { confirmRemoveFromTestDataset } from '../utils/testDataRemoveConfirm';
import {
  captureLocationListLine,
  captureLocationMapsUrl,
  formatDecimalLatLon,
  formatLatLon,
  formatUploadModeLabel,
} from '../utils/captureLocation';
import {
  captureDeviceTiltLevelLabel,
  captureDeviceTiltUnavailableReason,
  formatTiltDegrees,
} from '../utils/captureDeviceTilt';
import {
  cameraFacingSubLabel,
  captureCompassUnavailableReason,
  meterFacingPrimaryLabel,
} from '../utils/captureCompass';
const PORTAL_WORK_TYPES: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

export type ReadingDetailLocationState = {
  readingQueueIds?: string[];
  /** When opened from a list, go here instead of history.back() so Next/Prev does not trap “back” on another reading. */
  listReturn?: { pathname: string; search?: string };
};

/** Synthetic `<select>` value so any incorrect_* maps to one "Incorrect" row for reviewers. */
const REVIEWER_SELECT_INCORRECT = '__incorrect__' as const;

function isDialCropImage(image: MeterImage): boolean {
  return typeof image.metadata.dialIndex === 'number';
}

function isGuidedCropImage(image: MeterImage): boolean {
  if (isDialCropImage(image)) return false;
  const fn = (image.fileName || '').toLowerCase();
  if (fn === 'original.jpg') return true;
  if (/guided/i.test(image.label)) return true;
  return false;
}

function isFullMeterFrameImage(image: MeterImage): boolean {
  if (isDialCropImage(image)) return false;
  const fn = (image.fileName || '').toLowerCase();
  if (fn === 'full_meter.jpg') return true;
  if (/full\s*meter/i.test(image.label) && !/guided/i.test(image.label)) return true;
  return false;
}

function partitionMeterImages(images: MeterImage[]): {
  guidedCrop: MeterImage | undefined;
  fullMeter: MeterImage | undefined;
  dialImages: MeterImage[];
  otherImages: MeterImage[];
} {
  const dialImages = images
    .filter(isDialCropImage)
    .sort((a, b) => (a.metadata.dialIndex ?? 0) - (b.metadata.dialIndex ?? 0));

  const guidedCrop = images.find(isGuidedCropImage);
  const fullMeter = images.find(isFullMeterFrameImage);

  const claimed = new Set<string>([
    ...(guidedCrop ? [guidedCrop.id] : []),
    ...(fullMeter ? [fullMeter.id] : []),
    ...dialImages.map((d) => d.id),
  ]);
  const otherImages = images.filter((img) => !claimed.has(img.id));

  return { guidedCrop, fullMeter, dialImages, otherImages };
}

type DialDetailRow = DialDetailFromMetadata;

function mlBaselineMeterValue(reading: S3MeterReading): string {
  return fieldTestPredictedReading(reading) || String(reading.meterValue ?? '');
}

/** Baseline dial editor rows — reconciled with raw model read when per-dial rows are stale. */
function baselineDialRowsForReading(reading: S3MeterReading): DialDetailRow[] {
  return reconcileDialRowsForReading({
    ...reading,
    meterValue: mlBaselineMeterValue(reading),
  }).map((d) => ({ ...d }));
}

function dialRowHasExtendedPipeline(row: DialDetailRow | undefined): boolean {
  if (!row || typeof row !== 'object') return false;
  if (row.bounding_box != null && typeof row.bounding_box === 'object') return true;
  if (row.stage_1 != null && typeof row.stage_1 === 'object') return true;
  if (row.stage_2 != null && typeof row.stage_2 === 'object') return true;
  if (row.stage_3 != null && typeof row.stage_3 === 'object') return true;
  return false;
}

function fmtDialPt(p: DialPoint | undefined): string {
  if (!p || (p.x == null && p.y == null)) return '—';
  const x = p.x != null && Number.isFinite(p.x) ? String(Math.round(p.x * 10) / 10) : '—';
  const y = p.y != null && Number.isFinite(p.y) ? String(Math.round(p.y * 10) / 10) : '—';
  return `${x}, ${y}`;
}

/** Confidence shown as %; values in metadata are usually 0–1. */
function fmtConf01(n: number | undefined): string {
  return formatPortalAccuracyConfidencePctFromFraction(n);
}

function fmtDeg(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(Math.round(n * 100) / 100).toFixed(2)}°`;
}

function fmtVec(v: { dx?: number; dy?: number } | undefined): string {
  if (!v) return '—';
  const dx = v.dx != null && Number.isFinite(v.dx) ? (Math.round(v.dx * 10) / 10).toFixed(1) : '—';
  const dy = v.dy != null && Number.isFinite(v.dy) ? (Math.round(v.dy * 10) / 10).toFixed(1) : '—';
  return `(${dx}, ${dy})`;
}

function fmtBBox(b: DialDetailRow['bounding_box'] | undefined): string {
  if (!b) return '—';
  const f = (x: number | undefined) =>
    x != null && Number.isFinite(x) ? (Math.round(x * 1000) / 1000).toFixed(3) : '—';
  return `x ${f(b.x)} · y ${f(b.y)} · w ${f(b.w)} · h ${f(b.h)}`;
}

const DialPipelineModalBody: FC<{
  row: DialDetailRow;
  modelReading: string;
  /** 0-based index into `modelReading` for this dial crop (Dial 1 → 0). */
  dialIndexZeroBased: number;
}> = ({ row, modelReading, dialIndexZeroBased }) => {
  if (!dialRowHasExtendedPipeline(row)) {
    return (
      <div className="dial-pipeline-modal-empty">
        <p>No details found</p>
      </div>
    );
  }

  const s1 = row.stage_1;
  const s2 = row.stage_2;
  const s3 = row.stage_3;
  const bbox = s1?.bounding_box ?? s2?.bounding_box ?? row.bounding_box;

  return (
    <div className="dial-pipeline-modal-stages">
      <section className="dial-pipeline-stage-card" aria-label="Stage 1">
        <h3 className="dial-pipeline-stage-card-title">Stage 1 — Detection</h3>
        <dl className="dial-pipeline-kv">
          <dt>Bounding box</dt>
          <dd>{fmtBBox(bbox)}</dd>
          <dt>Detection confidence</dt>
          <dd>{fmtConf01(s1?.detection_confidence)}</dd>
        </dl>
      </section>

      <section className="dial-pipeline-stage-card" aria-label="Stage 2">
        <h3 className="dial-pipeline-stage-card-title">Stage 2 — Keypoints</h3>
        <dl className="dial-pipeline-kv">
          <dt>Dial center</dt>
          <dd>{fmtDialPt(s2?.dial_center)}</dd>
          <dt>Needle tip</dt>
          <dd>{fmtDialPt(s2?.needle_tip)}</dd>
          <dt>Zero mark</dt>
          <dd>{fmtDialPt(s2?.zero_mark)}</dd>
          <dt>Keypoint confidence</dt>
          <dd>{fmtConf01(s2?.keypoint_confidence)}</dd>
        </dl>
      </section>

      <section className="dial-pipeline-stage-card" aria-label="Stage 3">
        <h3 className="dial-pipeline-stage-card-title">Stage 3 — Angles & vectors</h3>
        <dl className="dial-pipeline-kv">
          <dt>Vector center → tip</dt>
          <dd>{fmtVec(s3?.vector_center_to_tip)}</dd>
          <dt>Vector center → zero</dt>
          <dd>{fmtVec(s3?.vector_center_to_zero)}</dd>
          <dt>Angular offset</dt>
          <dd>{fmtDeg(s3?.angular_offset_deg)}</dd>
          <dt>Normalized dial angle</dt>
          <dd>{fmtDeg(s3?.normalized_dial_angle_deg)}</dd>
          <dt>Angle to digit</dt>
          <dd>
            {s3?.angle_to_digit != null && Number.isFinite(s3.angle_to_digit)
              ? (Math.round(s3.angle_to_digit * 1000) / 1000).toFixed(3)
              : '—'}
          </dd>
          <dt>Stage 3 digit</dt>
          <dd>{s3?.digit != null && Number.isFinite(s3.digit) ? String(s3.digit) : '—'}</dd>
        </dl>
      </section>

      <section className="dial-pipeline-stage-card" aria-label="Stage 4">
        <h3 className="dial-pipeline-stage-card-title">Stage 4 — Full meter reading</h3>
        <dl className="dial-pipeline-kv">
          <dt>Model reading</dt>
          <dd className="dial-pipeline-kv-reading-row">
            {modelReading.trim() === '' ? (
              '—'
            ) : (
              Array.from(modelReading.trim()).map((ch, i) => {
                const isThisDialDigit = i === dialIndexZeroBased && /\d/.test(ch);
                return (
                  <span
                    key={`${i}-${ch}`}
                    className={isThisDialDigit ? 'dial-pipeline-stage4-digit' : 'dial-pipeline-stage4-ch'}
                  >
                    {ch}
                  </span>
                );
              })
            )}
          </dd>
        </dl>
      </section>
    </div>
  );
};

type StripDialEditProps = {
  onDigitChange: (digit: number) => void;
};

type ReadingDetailImageCardProps = {
  image: MeterImage;
  reading: S3MeterReading;
  /** On-device model digits for dial strip (separate from saved reviewer dial_details). */
  modelDialRows: DialDetailRow[];
  selectedImage: string | null;
  onActivate: (imageId: string) => void;
  strip?: boolean;
  stripReviewerEdit?: StripDialEditProps;
};

function normalizeDialDigit(v: number): number {
  return ((Math.round(v) % 10) + 10) % 10;
}

/** `s_YYYYMMDD_HHMMSS_suffix` → `MM/DD/YY · suffix` (drops the HHMMSS segment). */
function formatSessionIdForDisplay(id: string): string {
  const m = /^s_(\d{4})(\d{2})(\d{2})_\d{6}_(.+)$/.exec(id);
  if (!m) return id;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const suffix = m[4];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return id;
  return `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y % 100).padStart(2, '0')} · ${suffix}`;
}

const ReadingDetailImageCard: FC<ReadingDetailImageCardProps> = ({
  image,
  reading,
  modelDialRows,
  selectedImage,
  onActivate,
  strip,
  stripReviewerEdit,
}) => {
  const [stripDialEditorOpen, setStripDialEditorOpen] = useState(false);
  const [dialPipelineModalOpen, setDialPipelineModalOpen] = useState(false);

  const dialNumber =
    image.metadata.dialIndex !== undefined ? image.metadata.dialIndex + 1 : undefined;
  const modelDialDetail =
    dialNumber !== undefined
      ? modelDialRows.find((d) => d.dial === dialNumber)
      : undefined;
  const dialDetail =
    dialNumber !== undefined && reading.dialDetails
      ? reading.dialDetails.find((d) => d.dial === dialNumber)
      : undefined;

  const truthRaw = String(reading.expectedValue ?? '').replace(/\D/g, '');
  const truthReading = truthRaw ? truthRaw.padStart(4, '0').slice(-4) : '';
  const dialPosition = image.metadata.dialIndex;
  const modelDigit =
    modelDialDetail != null && Number.isFinite(Number(modelDialDetail.prediction))
      ? normalizeDialDigit(Number(modelDialDetail.prediction))
      : null;
  const truthChar =
    dialPosition !== undefined && truthReading.length > dialPosition
      ? truthReading[dialPosition]
      : undefined;
  const truthDigitNum =
    truthChar !== undefined && /\d/.test(truthChar) ? parseInt(truthChar, 10) : null;
  const hasReviewerCorrection =
    truthDigitNum !== null && modelDigit !== null && truthDigitNum !== modelDigit;
  const modelMatchesTruth =
    truthDigitNum !== null && modelDigit !== null && truthDigitNum === modelDigit;
  const editorDigit = truthDigitNum ?? modelDigit ?? 0;
  const pipelineRow = dialDetail ?? modelDialDetail;

  const isSelected = selectedImage === image.id;
  const stripEdit = strip && stripReviewerEdit ? stripReviewerEdit : undefined;

  const dialTitleId = `dial-pipeline-modal-title-${image.id}`;

  useEffect(() => {
    if (!dialPipelineModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDialPipelineModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialPipelineModalOpen]);

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
        {stripEdit && dialDetail ? (
          <button
            type="button"
            className="image-dial-strip-pencil"
            title="Correct this dial"
            aria-label={`Edit predicted digit for ${image.label}`}
            onClick={(e) => {
              e.stopPropagation();
              setStripDialEditorOpen((o) => !o);
            }}
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
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

      {(modelDialDetail || dialDetail) && (
        <div
          className="dial-prediction-display"
          onClick={(e) => {
            if (stripDialEditorOpen) e.stopPropagation();
          }}
        >
          <div className="prediction-row">
            <span className="prediction-label">Predicted:</span>
            {stripEdit && stripDialEditorOpen ? (
              <select
                className="image-dial-strip-digit-select"
                aria-label={`Ground truth digit for dial ${(image.metadata.dialIndex ?? 0) + 1}`}
                value={editorDigit}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) stripEdit.onDigitChange(v);
                  setStripDialEditorOpen(false);
                }}
              >
                {Array.from({ length: 10 }, (_, d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className={[
                  'prediction-number',
                  hasReviewerCorrection ? 'prediction-number--model-mismatch' : '',
                  !hasReviewerCorrection && modelMatchesTruth ? ' correct' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  hasReviewerCorrection
                    ? 'Model prediction (reviewer corrected this dial)'
                    : modelMatchesTruth
                      ? 'Model matches reviewer ground truth'
                      : undefined
                }
              >
                {modelDigit ?? modelDialDetail?.prediction ?? dialDetail?.prediction ?? '—'}
              </span>
            )}
          </div>
          {hasReviewerCorrection ? (
              <div className="prediction-row correct">
                <span className="prediction-label">Ground truth:</span>
                <span className="prediction-number correct">{truthDigitNum}</span>
              </div>
            ) : null}
          {pipelineRow?.confidence != null && Number.isFinite(pipelineRow.confidence) ? (
            <div className="prediction-confidence">
              {formatPortalAccuracyConfidencePctFromFraction(pipelineRow.confidence)} confidence
            </div>
          ) : null}
          <button
            type="button"
            className="dial-pipeline-more-btn"
            aria-haspopup="dialog"
            aria-expanded={dialPipelineModalOpen}
            aria-controls={dialPipelineModalOpen ? `dial-pipeline-dialog-${image.id}` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setDialPipelineModalOpen(true);
            }}
          >
            More details
          </button>
          {dialPipelineModalOpen && pipelineRow
            ? createPortal(
                <div
                  className="dial-pipeline-modal-overlay"
                  role="presentation"
                  onClick={() => setDialPipelineModalOpen(false)}
                >
                  <div
                    className="dial-pipeline-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={dialTitleId}
                    id={`dial-pipeline-dialog-${image.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="dial-pipeline-modal-head">
                      <div className="dial-pipeline-modal-head-text">
                        <h2 id={dialTitleId}>Dial {(image.metadata.dialIndex ?? 0) + 1}</h2>
                        <p className="dial-pipeline-modal-sub">Pipeline details</p>
                      </div>
                      <button
                        type="button"
                        className="dial-pipeline-modal-close"
                        onClick={() => setDialPipelineModalOpen(false)}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>
                    <div className="dial-pipeline-modal-body">
                      <DialPipelineModalBody
                        row={pipelineRow}
                        modelReading={reading.meterValue != null ? String(reading.meterValue) : ''}
                        dialIndexZeroBased={image.metadata.dialIndex ?? 0}
                      />
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>
      )}
    </div>
  );
};

function applyDetailFormToReading(
  base: S3MeterReading,
  opts: {
    selectedStatus: ReadingStatus;
    userCorrection: string;
    mlPrediction: string;
    comments: string;
    localDialRows: DialDetailRow[];
    datasetDestination: ReviewerDatasetDestination;
    imageDifficulty: ImageDifficulty;
    isManualUploadQueue: boolean;
    isReviewerSaveMode: boolean;
    markReviewed?: boolean;
    portalManualReviewChoice?: 'correct' | 'incorrect' | null;
    portalManualReviewNotes?: string;
  },
): S3MeterReading {
  const reviewerDatasetDestination = opts.isReviewerSaveMode
    ? opts.datasetDestination
    : base.reviewerDatasetDestination;
  return {
    ...base,
    status: opts.selectedStatus,
    expectedValue: opts.userCorrection || undefined,
    meterValue: opts.isManualUploadQueue ? opts.userCorrection : opts.mlPrediction,
    comments: opts.comments,
    dialDetails: opts.localDialRows.length > 0 ? opts.localDialRows : base.dialDetails,
    reviewerDatasetDestination,
    reviewerRecommendTraining:
      reviewerDatasetDestination === 'training' ||
      (reviewerDatasetDestination == null && base.reviewerRecommendTraining === true),
    imageDifficulty: opts.isReviewerSaveMode ? opts.imageDifficulty : base.imageDifficulty,
    isManuallyReviewed: opts.markReviewed ? true : base.isManuallyReviewed,
    isCorrect: opts.selectedStatus === 'correct',
    portalManualReviewStatus:
      opts.portalManualReviewChoice ?? base.portalManualReviewStatus ?? null,
    portalManualReviewNotes:
      opts.portalManualReviewNotes !== undefined
        ? opts.portalManualReviewNotes
        : base.portalManualReviewNotes,
    updatedAt: new Date().toISOString(),
  };
}

const ReadingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    getReadingById,
    updateReadingStatus,
    updateReadingComments,
    upsertReading,
    refreshCounts,
    workType: contextWorkType,
  } = useReadings();
  const { userEmail } = useAuth();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const isAdminMode = portalWorkMode === 'admin';
  const isLabelerMode = portalWorkMode === 'labeler';
  const isReviewerSaveMode = portalWorkMode === 'reviewer' || portalWorkMode === 'admin';
  const isTestDataReviewerMode = portalWorkMode === 'test_data_reviewer';

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
  const isManualUploadQueue = reading?.status === 'manually_uploaded';
  const isFieldTestCapture = reading ? isFieldTestPortalReading(reading) : false;

  const readingQueueIds = useMemo(() => {
    const st = location.state as ReadingDetailLocationState | null;
    return Array.isArray(st?.readingQueueIds) && st.readingQueueIds.length > 0 ? st.readingQueueIds : undefined;
  }, [location.state]);

  const listReturn = useMemo(() => {
    const st = location.state as ReadingDetailLocationState | null;
    const lr = st?.listReturn;
    if (!lr || typeof lr.pathname !== 'string' || !lr.pathname.trim()) return undefined;
    return { pathname: lr.pathname, search: lr.search ?? '' };
  }, [location.state]);

  const goBackToList = useCallback(() => {
    if (listReturn) {
      const s = listReturn.search;
      navigate({ pathname: listReturn.pathname, ...(s ? { search: s } : {}) });
    } else {
      navigate(-1);
    }
  }, [navigate, listReturn]);

  const queueIndex = useMemo(() => {
    if (!reading?.id || !readingQueueIds?.length) return -1;
    const ix = readingQueueIds.indexOf(reading.id);
    return ix;
  }, [reading?.id, readingQueueIds]);

  /** When true, dial edits do not overwrite "Correct reading" (user typed a different whole-meter value). */
  const [readingDetachedFromDials, setReadingDetachedFromDials] = useState(false);
  const [meterPhotosOpen, setMeterPhotosOpen] = useState(false);
  const [meterPhotoIndex, setMeterPhotoIndex] = useState(0);

  useEffect(() => {
    setMeterPhotosOpen(false);
    setMeterPhotoIndex(0);
  }, [reading?.id]);

  const [mlPrediction, setMlPrediction] = useState('');
  const [userCorrection, setUserCorrection] = useState('');
  const [localDialRows, setLocalDialRows] = useState<DialDetailRow[]>([]);
  /** Baseline per-dial predictions when this reading loaded (strip edits that differ → incorrect). */
  const initialDialRowsRef = useRef<DialDetailRow[]>([]);

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

  /** Frozen on-device model digits for dial strip (blue predicted vs green ground truth). */
  const modelDialRowsForStrip = useMemo((): DialDetailRow[] => {
    if (!reading) return [];
    return reconcileModelDialRowsForReading(reading).map((d) => ({ ...d }));
  }, [
    reading?.id,
    reading?.meterValue,
    reading?.rawPrediction,
    reading?.dialDetails,
    reading?.images,
  ]);

  const imagePartition = useMemo(
    () =>
      effectiveReading
        ? partitionMeterImages(effectiveReading.images)
        : {
            guidedCrop: undefined as MeterImage | undefined,
            fullMeter: undefined as MeterImage | undefined,
            dialImages: [] as MeterImage[],
            otherImages: [] as MeterImage[],
          },
    [effectiveReading],
  );

  const { guidedCrop, fullMeter, dialImages, otherImages } = imagePartition;
  const meterPhotoSlides = useMemo((): MeterPhotoSlide[] => {
    const slides: MeterPhotoSlide[] = [];
    if (guidedCrop) {
      slides.push({ image: guidedCrop, kind: 'guided', label: 'Guided crop' });
    }
    if (fullMeter) {
      slides.push({ image: fullMeter, kind: 'full', label: 'Full meter' });
    }
    return slides;
  }, [guidedCrop, fullMeter]);
  const hasMeterPhotos = meterPhotoSlides.length > 0;

  const openMeterPhotos = useCallback(() => {
    if (!meterPhotoSlides.length) return;
    const guidedIndex = Math.max(
      0,
      meterPhotoSlides.findIndex((slide) => slide.kind === 'guided'),
    );
    setMeterPhotoIndex(guidedIndex);
    setMeterPhotosOpen(true);
  }, [meterPhotoSlides]);

  const handleImageActivate = useCallback((imageId: string) => {
    setSelectedImage((prev) => (prev === imageId ? null : imageId));
  }, []);

  /** Single path for per-dial edits (dial strip cards). */
  const commitDialDigit = useCallback((dialNumber: number, raw: number) => {
    const n = normalizeDialDigit(raw);
    setReadingDetachedFromDials(false);
    setLocalDialRows((rows) => {
      const ix = rows.findIndex((r) => r.dial === dialNumber);
      if (ix < 0) return rows;
      return rows.map((row, i) => (i === ix ? { ...row, prediction: n } : row));
    });
    const modelRow = reconcileModelDialRowsForReading(reading ?? { dialDetails: [], images: [], meterValue: '' }).find(
      (r) => r.dial === dialNumber,
    );
    const baseDig =
      modelRow != null ? normalizeDialDigit(Number(modelRow.prediction)) : null;
    if (baseDig !== null && baseDig !== n) {
      if (!reading || !isFieldTestPortalReading(reading)) {
        setSelectedStatus((s) => (statusIsIncorrect(s) ? s : 'incorrect_new'));
      }
    }
  }, [reading]);

  const [comments, setComments] = useState(reading?.comments || '');
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus>(
    reading ? initialReviewerOutcomeStatus(reading) : 'incorrect_new',
  );
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [datasetDestination, setDatasetDestination] = useState<ReviewerDatasetDestination>(null);
  const [imageDifficulty, setImageDifficulty] = useState<ImageDifficulty>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [removeFromTestBusy, setRemoveFromTestBusy] = useState(false);
  const [portalManualReviewChoice, setPortalManualReviewChoice] = useState<'correct' | 'incorrect' | null>(null);
  const [portalManualReviewNotes, setPortalManualReviewNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFetchLoading(true);
    setFetchError(false);

    fetchReadingById(id, workTypeForApi, contextReading?.s3SessionPrefix)
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
  }, [id, workTypeForApi, contextReading?.s3SessionPrefix]);

  useEffect(() => {
    if (!reading) return;
    setComments(reading.comments || '');
    setSelectedStatus(
      isReviewerSaveMode ? initialReviewerOutcomeStatus(reading) : reading.status,
    );
    setMlPrediction(mlBaselineMeterValue(reading));
    const baseRows = baselineDialRowsForReading(reading);
    const fromDials = concatDialDigitsFromRows(baseRows);
    const exp = reading.expectedValue != null ? String(reading.expectedValue).trim() : '';
    const mvStr = reading.meterValue != null ? String(reading.meterValue).trim() : '';
    setReadingDetachedFromDials(Boolean(exp !== '' && exp !== fromDials));
    setUserCorrection(exp || fromDials || mvStr);
    setLocalDialRows(baseRows.map((d) => ({ ...d })));
    initialDialRowsRef.current = baseRows.map((d) => ({ ...d }));
    setDatasetDestination(
      reading.reviewerDatasetDestination ??
        (reading.reviewerRecommendTraining ? 'training' : null),
    );
    setImageDifficulty(reading.imageDifficulty ?? null);
    const portalStatus = normalizePortalManualReviewStatus(reading.portalManualReviewStatus);
    setPortalManualReviewChoice(portalStatus === 'pending' ? null : portalStatus);
    setPortalManualReviewNotes(reading.portalManualReviewNotes || '');
  }, [
    reading?.id,
    reading?.status,
    reading?.s3SessionPrefix,
    reading?.meterValue,
    reading?.rawPrediction,
    reading?.expectedValue,
    reading?.comments,
    reading?.dialDetails,
    reading?.reviewerRecommendTraining,
    reading?.reviewerDatasetDestination,
    reading?.imageDifficulty,
    reading?.portalManualReviewStatus,
    reading?.portalManualReviewNotes,
    isReviewerSaveMode,
  ]);

  const portalManualReviewDirty = useMemo(() => {
    const r = directReading || contextReading;
    if (!r || !isFieldTestCapture) return false;
    const savedStatus = normalizePortalManualReviewStatus(r.portalManualReviewStatus);
    const savedNotes = r.portalManualReviewNotes || '';
    if (savedStatus === 'pending') {
      return portalManualReviewChoice === 'correct' || portalManualReviewChoice === 'incorrect';
    }
    return (
      portalManualReviewChoice !== savedStatus || portalManualReviewNotes !== savedNotes
    );
  }, [
    directReading,
    contextReading,
    isFieldTestCapture,
    portalManualReviewChoice,
    portalManualReviewNotes,
  ]);

  const isDirty = useMemo(() => {
    const r = directReading || contextReading;
    if (!r) return false;
    if (isLabelerMode) {
      return selectedStatus !== r.status;
    }
    const baseExpected = r.expectedValue != null ? String(r.expectedValue) : '';
    const baseMeter = mlBaselineMeterValue(r);
    const baseComments = r.comments || '';
    const baseDialStr = JSON.stringify(baselineDialRowsForReading(r));
    const newDialStr = JSON.stringify(localDialRows);
    const baseDest =
      r.reviewerDatasetDestination ?? (r.reviewerRecommendTraining ? 'training' : null);
    const baseDifficulty = r.imageDifficulty ?? null;
    return (
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr ||
      comments !== baseComments ||
      (!isFieldTestCapture && selectedStatus !== r.status) ||
      datasetDestination !== baseDest ||
      imageDifficulty !== baseDifficulty
    );
  }, [
    isLabelerMode,
    isFieldTestCapture,
    directReading,
    contextReading,
    userCorrection,
    mlPrediction,
    localDialRows,
    comments,
    selectedStatus,
    datasetDestination,
    imageDifficulty,
  ]);

  const hasUnsavedChanges = useMemo(
    () => isDirty || (isFieldTestCapture && portalManualReviewDirty),
    [isDirty, isFieldTestCapture, portalManualReviewDirty],
  );

  const showPortalIncorrectReadingHint = useMemo(() => {
    if (!isFieldTestCapture || !isReviewerSaveMode || portalManualReviewChoice !== 'incorrect') {
      return false;
    }
    const r = directReading || contextReading;
    if (!r) return false;
    const baseExpected = r.expectedValue != null ? String(r.expectedValue) : '';
    const baseMeter = mlBaselineMeterValue(r);
    const baseDialStr = JSON.stringify(baselineDialRowsForReading(r));
    const newDialStr = JSON.stringify(localDialRows);
    const readingUpdated =
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr;
    if (readingUpdated) return false;
    if (normalizePortalManualReviewStatus(r.portalManualReviewStatus) === 'incorrect') {
      return false;
    }
    return true;
  }, [
    isFieldTestCapture,
    isReviewerSaveMode,
    portalManualReviewChoice,
    directReading,
    contextReading,
    userCorrection,
    mlPrediction,
    localDialRows,
  ]);

  const performSaveAction = useCallback(async (): Promise<boolean> => {
    const r = directReading || contextReading;
    if (!r?.s3SessionPrefix) {
      alert(
        isLabelerMode
          ? 'This session cannot be moved. Contact an administrator.'
          : 'This session cannot be saved. Contact an administrator.',
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
        const optimistic = applyDetailFormToReading(r, {
          selectedStatus,
          userCorrection,
          mlPrediction,
          comments,
          localDialRows,
          datasetDestination,
          imageDifficulty,
          isManualUploadQueue,
          isReviewerSaveMode,
        });
        setDirectReading(optimistic);
        upsertReading(optimistic);
        setSelectedStatus(selectedStatus);
        updateReadingComments(optimistic.id, optimistic.comments || '');

        await updateReadingStatus(r.id, selectedStatus, optimistic, r.status);
        void fetchReadingById(r.id, workTypeForApi, r.s3SessionPrefix).then((latest) => {
          if (latest) {
            setDirectReading(latest);
            upsertReading(latest);
            setSelectedStatus(latest.status);
          }
        });

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
    const fieldTestCapture = isFieldTestPortalReading(snapshotForMove);
    const baseExpected = r.expectedValue != null ? String(r.expectedValue) : '';
    const baseMeter = mlBaselineMeterValue(r);
    const baseComments = r.comments || '';
    const baseDialStr = JSON.stringify(baselineDialRowsForReading(r));
    const newDialStr = JSON.stringify(localDialRows);
    const baseDest =
      r.reviewerDatasetDestination ?? (r.reviewerRecommendTraining ? 'training' : null);
    const baseDifficulty = r.imageDifficulty ?? null;

    const targetStatus = fieldTestCapture
      ? snapshotForMove.status
      : isReviewerSaveMode
        ? resolveReviewerSaveStatus(selectedStatus, snapshotForMove.status)
        : selectedStatus;
    const desiredIsCorrect = targetStatus === 'correct';
    const baseIsCorrect = r.isCorrect ?? r.status === 'correct';

    const metaDirty =
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr ||
      comments !== baseComments ||
      datasetDestination !== baseDest ||
      imageDifficulty !== baseDifficulty ||
      (isReviewerSaveMode && !fieldTestCapture && desiredIsCorrect !== baseIsCorrect);

    const portalReviewDirty =
      fieldTestCapture &&
      isReviewerSaveMode &&
      (() => {
        const savedStatus = normalizePortalManualReviewStatus(r.portalManualReviewStatus);
        const savedNotes = r.portalManualReviewNotes || '';
        if (savedStatus === 'pending') {
          return portalManualReviewChoice === 'correct' || portalManualReviewChoice === 'incorrect';
        }
        return (
          portalManualReviewChoice !== savedStatus || portalManualReviewNotes !== savedNotes
        );
      })();

    if (portalReviewDirty) {
      if (portalManualReviewChoice !== 'correct' && portalManualReviewChoice !== 'incorrect') {
        alert('Choose Portal review: Correct or Incorrect before saving.');
        return false;
      }
    }

    const readingMetaDirty =
      userCorrection !== baseExpected ||
      mlPrediction !== baseMeter ||
      newDialStr !== baseDialStr;

    const newlyMarkingPortalIncorrect =
      portalReviewDirty &&
      portalManualReviewChoice === 'incorrect' &&
      normalizePortalManualReviewStatus(r.portalManualReviewStatus) !== 'incorrect';

    if (newlyMarkingPortalIncorrect && !readingMetaDirty) {
      alert(
        'Portal review is Incorrect — update the reading before saving. Use the pencil on dial crops or edit the correct whole-meter reading.',
      );
      return false;
    }

    const statusWillChange = !fieldTestCapture && targetStatus !== snapshotForMove.status;
    const shouldMarkManual = r.isManuallyReviewed !== true && (metaDirty || statusWillChange);

    const optimistic = applyDetailFormToReading(snapshotForMove, {
      selectedStatus: targetStatus,
      userCorrection,
      mlPrediction,
      comments,
      localDialRows,
      datasetDestination,
      imageDifficulty,
      isManualUploadQueue,
      isReviewerSaveMode,
      markReviewed: shouldMarkManual,
      portalManualReviewChoice: portalReviewDirty ? portalManualReviewChoice : undefined,
      portalManualReviewNotes: portalReviewDirty ? portalManualReviewNotes : undefined,
    });
    setDirectReading(optimistic);
    upsertReading(optimistic);
    setSelectedStatus(optimistic.status);
    updateReadingComments(optimistic.id, optimistic.comments || '');

    setIsSaving(true);
    let savedReading: S3MeterReading | null = null;
    let patchPrefix = snapshotForMove.s3SessionPrefix;
    let didPersist = false;
    try {
      if (isReviewerSaveMode && statusWillChange && snapshotForMove.s3SessionPrefix) {
        didPersist = true;
        await updateReadingStatus(
          snapshotForMove.id,
          targetStatus,
          optimistic,
          snapshotForMove.status,
        );
        const movedPrefix = buildTargetSessionPrefixFromSource(
          snapshotForMove.s3SessionPrefix,
          snapshotForMove.type,
          targetStatus,
        );
        if (movedPrefix) {
          patchPrefix = movedPrefix;
          const withNewPrefix = { ...optimistic, s3SessionPrefix: movedPrefix };
          setDirectReading(withNewPrefix);
          upsertReading(withNewPrefix);
        }
      }

      if (metaDirty || shouldMarkManual || portalReviewDirty) {
        if (!patchPrefix) {
          alert('This session cannot be saved. Contact an administrator.');
          return false;
        }
        didPersist = true;
        const patch: SessionMetadataPatch = {};
        if (metaDirty) {
          patch.ml_prediction = isManualUploadQueue ? userCorrection : mlPrediction;
          patch.user_correction = userCorrection;
          const rawSnap = fieldTestPredictedReading(snapshotForMove);
          if (rawSnap) {
            patch.ml_raw_prediction = rawSnap;
          }
          patch.portal_review_notes = comments;
          if (isReviewerSaveMode) {
            if (datasetDestination !== baseDest) {
              patch.reviewer_dataset_destination = datasetDestination;
            }
            if (imageDifficulty !== baseDifficulty) {
              patch.image_difficulty = imageDifficulty;
            }
          }
          const hadDialDetails = (r.dialDetails?.length ?? 0) > 0;
          if (localDialRows.length > 0) {
            patch.dial_details = localDialRows.map((row) => {
              const dial = Math.round(Number(row.dial)) || 1;
              const prediction = Number(row.prediction);
              const direction = String(row.direction || 'clockwise').slice(0, 40);
              const confidence = Math.min(1, Math.max(0, Number(row.confidence)));
              const { dial: _d, prediction: _p, direction: _dir, confidence: _c, ...rest } = row;
              return { ...rest, dial, prediction, direction, confidence };
            });
          } else if (hadDialDetails) {
            patch.dial_details = [];
          }
        }
        if (shouldMarkManual) {
          patch.is_manually_reviewed = true;
        }
        if (isReviewerSaveMode && !fieldTestCapture) {
          patch.is_correct = desiredIsCorrect;
        }
        if (portalReviewDirty && portalManualReviewChoice) {
          patch.portal_manual_review_status = portalManualReviewChoice;
          patch.portal_manual_review_notes = portalManualReviewNotes;
        }

        savedReading = await patchSessionMetadata(
          snapshotForMove.id,
          workTypeForApi,
          { s3SessionPrefix: patchPrefix, patch },
          userEmail || undefined,
          portalWorkMode,
        );
        const merged = applyDetailFormToReading(savedReading, {
          selectedStatus: targetStatus,
          userCorrection,
          mlPrediction,
          comments,
          localDialRows,
          datasetDestination,
          imageDifficulty,
          isManualUploadQueue,
          isReviewerSaveMode,
          markReviewed: shouldMarkManual,
          portalManualReviewChoice: portalReviewDirty ? portalManualReviewChoice : undefined,
          portalManualReviewNotes: portalReviewDirty ? portalManualReviewNotes : undefined,
        });
        setDirectReading(merged);
        upsertReading(merged);
        setSelectedStatus(merged.status);
      }

      if (statusWillChange) {
        void fetchReadingById(snapshotForMove.id, workTypeForApi, patchPrefix ?? undefined).then(
          (latest) => {
            if (latest) {
              setDirectReading(latest);
              upsertReading(latest);
              setSelectedStatus(latest.status);
            }
          },
        );
      }

      if (!didPersist) {
        return true;
      }

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
    upsertReading,
    refreshCounts,
    datasetDestination,
    imageDifficulty,
    isReviewerSaveMode,
    portalWorkMode,
    isManualUploadQueue,
    portalManualReviewChoice,
    portalManualReviewNotes,
  ]);

  const handleApproveUnitTest = useCallback(async () => {
    const r = directReading || contextReading;
    if (!r?.id) return;
    setApproveBusy(true);
    try {
      if (hasUnsavedChanges) {
        const saved = await performSaveAction();
        if (!saved) return;
      }
      const res = await approveSessionForUnitTest(
        r.id,
        workTypeForApi,
        userEmail || undefined,
        r.s3SessionPrefix,
      );
      setDirectReading(res.reading);
      upsertReading(res.reading);
      void refreshCounts({ silent: true });
      window.alert(`Approved — unit test image ${res.fileName} added to the library.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setApproveBusy(false);
    }
  }, [contextReading, directReading, isDirty, performSaveAction, upsertReading, refreshCounts, userEmail, workTypeForApi]);

  const handleRemoveFromTestDataset = useCallback(async () => {
    const r = directReading || contextReading;
    if (!r?.id || !r.s3SessionPrefix) return;
    if (!confirmRemoveFromTestDataset(r)) {
      return;
    }
    setRemoveFromTestBusy(true);
    try {
      if (hasUnsavedChanges) {
        const saved = await performSaveAction();
        if (!saved) return;
      }
      const res = await removeSessionFromTestDataset(
        r.id,
        workTypeForApi,
        userEmail || undefined,
        r.s3SessionPrefix,
      );
      if (res.reading) upsertReading(res.reading);
      void refreshCounts({ silent: true });
      goBackToList();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Remove from test dataset failed');
    } finally {
      setRemoveFromTestBusy(false);
    }
  }, [
    contextReading,
    directReading,
    goBackToList,
    isDirty,
    performSaveAction,
    refreshCounts,
    upsertReading,
    userEmail,
    workTypeForApi,
  ]);

  const handleSave = useCallback(() => {
    void performSaveAction();
  }, [performSaveAction]);

  const showHeaderSaveButton = isReviewerSaveMode || isTestDataReviewerMode;
  const headerSaveDisabled =
    isSaving ||
    !hasUnsavedChanges ||
    (isTestDataReviewerMode && (removeFromTestBusy || approveBusy));
  const headerSaveLabel = isTestDataReviewerMode ? 'Save corrections' : 'Save changes';

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
      const st = location.state as ReadingDetailLocationState | null;
      navigate(
        {
          pathname: `/reading/${encodeURIComponent(nextId)}`,
          search: qs ? `?${qs}` : '',
        },
        { state: { readingQueueIds, listReturn: st?.listReturn } },
      );
    },
    [readingQueueIds, queueIndex, searchParams, navigate, location.state],
  );

  const rNow = directReading || contextReading;
  const portalReviewIncorrect =
    isFieldTestCapture &&
    (portalManualReviewChoice === 'incorrect' ||
      normalizePortalManualReviewStatus(rNow?.portalManualReviewStatus) === 'incorrect');
  const incorrectContext = (() => {
    if (!rNow) return false;
    if (portalReviewIncorrect) return true;
    return statusIsIncorrect(selectedStatus) || statusIsIncorrect(rNow.status);
  })();
  useEffect(() => {
    if (isLabelerMode || !incorrectContext || readingDetachedFromDials) return;
    const next = concatDialDigitsFromRows(localDialRows);
    setUserCorrection(next);
  }, [localDialRows, isLabelerMode, incorrectContext, readingDetachedFromDials]);

  useEffect(() => {
    if (!incorrectContext || isLabelerMode) return;
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
  }, [incorrectContext, isLabelerMode, isSaving, canQueuePrev, canQueueNext, navigateQueue, performSaveAction]);

  useEffect(() => {
    if (!moreDetailsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreDetailsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreDetailsOpen]);

  if (fetchLoading) {
    return (
      <div className="detail-page">
        <header className="page-header">
          <div className="header-content">
            <button type="button" className="back-button" onClick={goBackToList}>
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
          <button type="button" onClick={goBackToList}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Check if we have extended S3 metadata
  const hasS3Metadata = reading.confidence !== undefined || reading.dialDetails !== undefined;

  const useDialStripLayout = dialImages.length > 0;

  return (
    <div className="detail-page">
      <header className="page-header">
        <div className="header-content reading-detail-header">
          <div className="reading-detail-header-lead">
            <button type="button" className="back-button" onClick={goBackToList}>
              <ArrowLeft size={20} />
              <span>Back to List</span>
            </button>
            <div className="page-title">
              <Gauge size={32} strokeWidth={1.5} />
              <div>
                <h1>Reading Details</h1>
                <p title={reading.id}>ID: {formatSessionIdForDisplay(reading.id)}</p>
              </div>
            </div>
          </div>
          <div className="reading-detail-header-actions">
            {readingQueueIds && readingQueueIds.length > 0 && queueIndex >= 0 ? (
              <div className="reading-detail-header-queue" role="group" aria-label="Position in list">
                <button
                  type="button"
                  className="reading-detail-header-nav-btn"
                  onClick={() => navigateQueue(-1)}
                  disabled={!canQueuePrev || isSaving}
                >
                  <ChevronLeft size={18} aria-hidden />
                  Previous
                </button>
                <span className="reading-detail-header-queue-count" aria-live="polite">
                  {queueIndex + 1} / {readingQueueIds.length}
                </span>
                <button
                  type="button"
                  className="reading-detail-header-nav-btn"
                  onClick={() => navigateQueue(1)}
                  disabled={!canQueueNext || isSaving}
                >
                  Next
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
            ) : null}
            {showHeaderSaveButton ? (
              <button
                type="button"
                className={`save-button reading-detail-header-save-btn ${isSaved ? 'saved' : ''} ${isSaving ? 'saving' : ''}`}
                onClick={handleSave}
                disabled={headerSaveDisabled}
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
                    <span>{headerSaveLabel}</span>
                  </>
                )}
              </button>
            ) : null}
            <button
              type="button"
              className="reading-detail-more-details-btn"
              onClick={() => setMoreDetailsOpen(true)}
            >
              More details
            </button>
          </div>
        </div>
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
            <section className="images-section" id="reading-detail-dial-crops">
              <div className="images-section-head">
                <h2>
                  <ImageIcon size={20} aria-hidden />
                  {useDialStripLayout ? 'Dial crops' : 'Other images'}{' '}
                  <span className="images-section-count">
                    ({useDialStripLayout ? dialImages.length : otherImages.length})
                  </span>
                </h2>
                {hasMeterPhotos ? (
                  <button
                    type="button"
                    className="full-meter-view-btn"
                    onClick={() => openMeterPhotos()}
                    title="Open guided and full meter photos"
                  >
                    <Maximize2 size={16} aria-hidden />
                    Full meter view
                  </button>
                ) : null}
              </div>
              {useDialStripLayout ? (
                <p className="images-section-lead">
                  {hasMeterPhotos
                    ? 'Use Full meter view for the uncropped photo; the row below is per-dial model crops.'
                    : 'Per-dial model crops from the guided capture frame.'}
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
                      modelDialRows={modelDialRowsForStrip}
                      selectedImage={selectedImage}
                      onActivate={handleImageActivate}
                      strip
                      stripReviewerEdit={
                        !isLabelerMode
                          ? {
                              onDigitChange: (digit) =>
                                commitDialDigit((image.metadata.dialIndex ?? 0) + 1, digit),
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : otherImages.length > 0 ? (
                <div className="images-grid">
                  {otherImages.map((image) => (
                    <ReadingDetailImageCard
                      key={image.id}
                      image={image}
                      reading={effectiveReading!}
                      modelDialRows={modelDialRowsForStrip}
                      selectedImage={selectedImage}
                      onActivate={handleImageActivate}
                    />
                  ))}
                </div>
              ) : null}

              {useDialStripLayout && otherImages.length > 0 ? (
                <>
                  <h3 className="images-section-subheading">Other images</h3>
                  <div className="images-grid images-grid--secondary">
                    {otherImages.map((image) => (
                      <ReadingDetailImageCard
                        key={image.id}
                        image={image}
                        reading={effectiveReading!}
                        modelDialRows={modelDialRowsForStrip}
                        selectedImage={selectedImage}
                        onActivate={handleImageActivate}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            {!isManualUploadQueue &&
            (hasS3Metadata || (isLabelerMode && reading.dialDetails && reading.dialDetails.length > 0)) && (
              <section className="ml-metrics-section reading-detail-ml">
                <h2>
                  <Zap size={20} /> Reading check
                </h2>
                {hasS3Metadata ? (
                  <div className="metrics-grid">
                    {reading.confidence !== undefined && (
                      <div className="metric-card">
                        <Target size={24} />
                        <div className="metric-value">{formatPortalAccuracyConfidencePctFromFraction(reading.confidence)}</div>
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
                            <td>{formatPortalAccuracyConfidencePctFromFraction(dial.confidence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            )}

            {isAdminMode ? (
              <SessionActivitySection sessionId={reading.id} portalWorkMode={portalWorkMode} />
            ) : null}
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
              ) : isTestDataReviewerMode ? (
                <>
                  <ol className="reading-detail-tdr-steps">
                    <li>Fix the reading on the image (dials or correct reading).</li>
                    <li>
                      <strong>Save corrections</strong>, then approve or remove from the test queue.
                    </li>
                  </ol>
                  {reading.testDataReviewStatus === 'approved' && reading.testDataUnitTestFileName ? (
                    <p className="training-pipeline-bar-meta">
                      Approved · <code>{reading.testDataUnitTestFileName}</code>
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className={`save-button ${isSaved ? 'saved' : ''}`}
                    onClick={handleSave}
                    disabled={isSaving || removeFromTestBusy || approveBusy || !isDirty}
                  >
                    {isSaving ? <Loader2 size={18} className="spin" /> : <Save size={18} />}
                    {isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save corrections'}
                  </button>
                  <div className="reading-detail-tdr-actions">
                    <button
                      type="button"
                      className="reading-detail-tdr-approve-btn"
                      disabled={
                        approveBusy ||
                        removeFromTestBusy ||
                        isSaving ||
                        reading.reviewerDatasetDestination !== 'test'
                      }
                      onClick={() => void handleApproveUnitTest()}
                    >
                      {approveBusy ? <Loader2 size={18} className="spin" /> : <UserCheck size={18} />}
                      {reading.testDataReviewStatus === 'approved'
                        ? 'Update unit test image'
                        : 'Approve for unit test'}
                    </button>
                    <button
                      type="button"
                      className="test-data-remove-btn"
                      disabled={removeFromTestBusy || approveBusy || isSaving}
                      onClick={() => void handleRemoveFromTestDataset()}
                    >
                      {removeFromTestBusy ? (
                        <Loader2 size={18} className="spin" aria-hidden />
                      ) : (
                        <XCircle size={18} aria-hidden />
                      )}
                      Remove from test dataset
                    </button>
                  </div>
                  <div className="comments-control reading-detail-comments-optional">
                    <label htmlFor="reading-detail-comments-tdr">
                      Comments <span className="reading-detail-optional-tag">(optional)</span>
                    </label>
                    <textarea
                      id="reading-detail-comments-tdr"
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={2}
                      placeholder="Notes for this session…"
                    />
                  </div>
                </>
              ) : (
                <>
                  {isManualUploadQueue ? (
                    <>
                      <p className="reading-detail-field-hint">
                        Type the 4-digit reading, then choose <strong>Correct</strong> and save. Or use{' '}
                        <strong>Label uploads</strong> in the sidebar.
                      </p>
                      <label className="reading-detail-meta-field" htmlFor="manual-queue-expected">
                        <span>Correct reading</span>
                        <input
                          id="manual-queue-expected"
                          className="reading-detail-meta-input manual-label-input"
                          placeholder="0000"
                          value={userCorrection}
                          disabled={isSaving}
                          inputMode="numeric"
                          maxLength={4}
                          onChange={(e) =>
                            setUserCorrection(e.target.value.replace(/\D/g, '').slice(0, 4))
                          }
                        />
                      </label>
                    </>
                  ) : null}

                  {isFieldTestCapture ? (
                    <>
                      <div className="reading-detail-field-test-outcome">
                        <span className="reading-detail-viewonly-label">Field test</span>
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
                      </div>

                      {isReviewerSaveMode ? (
                        <div className="reading-detail-portal-manual-review">
                          {(() => {
                            const portalStatus = normalizePortalManualReviewStatus(
                              reading.portalManualReviewStatus,
                            );
                            const current = portalManualReviewBadge(portalStatus);
                            return (
                              <>
                                <div className="reading-detail-portal-manual-review-head">
                                  <span className="reading-detail-viewonly-label">Portal review</span>
                                  {portalStatus !== 'pending' ? (
                                    <span
                                      className="reading-detail-status-pill"
                                      style={{
                                        borderColor: current.color,
                                        color: current.color,
                                        backgroundColor: `${current.color}14`,
                                      }}
                                    >
                                      {current.label}
                                    </span>
                                  ) : null}
                                </div>
                                {reading.portalManualReviewedBy ? (
                                  <p className="reading-detail-field-hint reading-detail-portal-manual-review-meta">
                                    Saved by {reading.portalManualReviewedBy}
                                  </p>
                                ) : null}
                              </>
                            );
                          })()}
                          <div
                            className="reading-detail-portal-manual-review-options"
                            role="radiogroup"
                            aria-label="Portal review"
                          >
                            <label className="reading-detail-radio">
                              <input
                                type="radio"
                                name="portal-manual-review"
                                checked={portalManualReviewChoice === 'correct'}
                                onChange={() => setPortalManualReviewChoice('correct')}
                              />
                              Correct
                            </label>
                            <label className="reading-detail-radio">
                              <input
                                type="radio"
                                name="portal-manual-review"
                                checked={portalManualReviewChoice === 'incorrect'}
                                onChange={() => setPortalManualReviewChoice('incorrect')}
                              />
                              Incorrect
                            </label>
                          </div>
                          {showPortalIncorrectReadingHint ? (
                            <p
                              className="reading-detail-portal-manual-review-hint"
                              role="status"
                            >
                              You marked this Incorrect — update the reading before saving. Use the{' '}
                              <strong>pencil</strong> on dial crops below, or edit the correct whole-meter
                              reading in More details.
                            </p>
                          ) : null}
                          <div className="comments-control reading-detail-portal-manual-review-notes">
                            <label htmlFor="portal-manual-review-notes">
                              Notes <span className="reading-detail-optional-tag">(optional)</span>
                            </label>
                            <textarea
                              id="portal-manual-review-notes"
                              rows={2}
                              value={portalManualReviewNotes}
                              onChange={(e) => setPortalManualReviewNotes(e.target.value)}
                              placeholder="Add a note…"
                            />
                          </div>
                          <button
                            type="button"
                            className={`save-button reading-detail-portal-manual-review-save ${isSaved ? 'saved' : ''} ${isSaving ? 'saving' : ''}`}
                            onClick={handleSave}
                            disabled={isSaving || !hasUnsavedChanges}
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
                                <span>Save review</span>
                              </>
                            )}
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                  <div className="status-control">
                    <label htmlFor="reading-detail-status">Outcome</label>
                    <select
                      id="reading-detail-status"
                      value={
                        selectedStatus === 'manually_uploaded'
                          ? 'manually_uploaded'
                          : statusIsIncorrect(selectedStatus)
                            ? REVIEWER_SELECT_INCORRECT
                            : selectedStatus
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === REVIEWER_SELECT_INCORRECT) {
                          setSelectedStatus((prev) => (statusIsIncorrect(prev) ? prev : 'incorrect_new'));
                        } else {
                          setSelectedStatus(raw as ReadingStatus);
                        }
                      }}
                      style={{
                        borderColor: statusColors[selectedStatus],
                        backgroundColor: `${statusColors[selectedStatus]}10`,
                      }}
                    >
                      {(selectedStatus === 'manually_uploaded' || reading.status === 'manually_uploaded') && (
                        <option value="manually_uploaded">{statusLabels.manually_uploaded}</option>
                      )}
                      <option value="correct">{statusLabels.correct}</option>
                      <option value={REVIEWER_SELECT_INCORRECT}>Incorrect</option>
                      <option value="no_dials">{statusLabels.no_dials}</option>
                      <option value="not_sure">{statusLabels.not_sure}</option>
                    </select>
                  </div>
                  )}

                  {!isFieldTestCapture ? (
                  <fieldset className="reading-detail-radio-group">
                    <legend>Dataset</legend>
                    <label className="reading-detail-radio">
                      <input
                        type="radio"
                        name="dataset-destination"
                        checked={datasetDestination === 'training'}
                        onChange={() => setDatasetDestination('training')}
                      />
                      Send to training dataset
                    </label>
                    <label className="reading-detail-radio">
                      <input
                        type="radio"
                        name="dataset-destination"
                        checked={datasetDestination === 'test'}
                        onChange={() => setDatasetDestination('test')}
                      />
                      Send to test dataset
                    </label>
                    <label className="reading-detail-radio">
                      <input
                        type="radio"
                        name="dataset-destination"
                        checked={datasetDestination !== 'training' && datasetDestination !== 'test'}
                        onChange={() => setDatasetDestination(null)}
                      />
                      Neither
                    </label>
                    <p className="reading-detail-field-hint">
                      Test dataset rows are approved by the <strong>test data reviewer</strong> role.
                    </p>
                  </fieldset>
                  ) : null}

                  {!isFieldTestCapture ? (
                  <>
                  <fieldset className="reading-detail-radio-group">
                    <legend>Image classification</legend>
                    {(
                      [
                        ['normal', 'Normal'],
                        ['difficult', 'Difficult'],
                        ['very_difficult', 'Very difficult'],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="reading-detail-radio">
                        <input
                          type="radio"
                          name="image-difficulty"
                          checked={imageDifficulty === value}
                          onChange={() => setImageDifficulty(value)}
                        />
                        {label}
                      </label>
                    ))}
                    <label className="reading-detail-radio">
                      <input
                        type="radio"
                        name="image-difficulty"
                        checked={!imageDifficulty}
                        onChange={() => setImageDifficulty(null)}
                      />
                      Unset
                    </label>
                  </fieldset>

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
                      Review notes are saved when you save.
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
                        <span>Save changes</span>
                      </>
                    )}
                  </button>
                  </>
                  ) : null}
                </>
              )}
            </section>
          </aside>
        </div>
      </main>

      {moreDetailsOpen ? (
        <div
          className="reading-detail-more-modal-overlay"
          role="presentation"
          onClick={() => setMoreDetailsOpen(false)}
        >
          <div
            className="reading-detail-more-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-detail-more-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reading-detail-more-modal-head">
              <h2 id="reading-detail-more-modal-title">Session details</h2>
              <button
                type="button"
                className="reading-detail-more-modal-close"
                onClick={() => setMoreDetailsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="reading-detail-more-modal-body">
              {!isLabelerMode ? (
                <>
                  <h3 className="reading-detail-more-modal-subtitle">Readings</h3>
                  <p className="reading-detail-field-hint">
                    Use the <strong>pencil</strong> on dial crops to fix digits. Whole-meter fields here sync with save
                    in the sidebar.
                  </p>
                  {readingQueueIds && readingQueueIds.length > 0 && queueIndex >= 0 ? (
                    <p className="reading-detail-field-hint reading-detail-inline-queue">
                      <strong>{queueIndex + 1}</strong> of {readingQueueIds.length} in this list ·{' '}
                      <code title={reading.id}>{formatSessionIdForDisplay(reading.id)}</code>
                    </p>
                  ) : (
                    <p className="reading-detail-field-hint">
                      <code title={reading.id}>{formatSessionIdForDisplay(reading.id)}</code>
                    </p>
                  )}
                  <div className="reading-detail-metadata-fields">
                    <label className="reading-detail-meta-field" htmlFor="rd-ml-pred-modal">
                      <span>Reading from model</span>
                      <input
                        id="rd-ml-pred-modal"
                        className="reading-detail-meta-input"
                        value={mlPrediction}
                        onChange={(e) => setMlPrediction(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="reading-detail-meta-field" htmlFor="rd-user-corr-modal">
                      <span>Correct reading (whole meter)</span>
                      <input
                        id="rd-user-corr-modal"
                        className="reading-detail-meta-input"
                        value={userCorrection}
                        onChange={(e) => {
                          if (incorrectContext) setReadingDetachedFromDials(true);
                          setUserCorrection(e.target.value);
                        }}
                        placeholder={
                          incorrectContext
                            ? 'Digits from dial row above, or type the full reading'
                            : 'What the dials should read overall'
                        }
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  {incorrectContext && localDialRows.length > 0 ? (
                    <p className="reading-detail-field-hint">
                      <button
                        type="button"
                        className="training-hub-text-btn"
                        onClick={() => {
                          setReadingDetachedFromDials(false);
                          setUserCorrection(concatDialDigitsFromRows(localDialRows));
                        }}
                      >
                        Use digits from dials
                      </button>
                      <span> — fills from dial 1→4 (left to right) using the dial row on the page.</span>
                    </p>
                  ) : null}
                  {incorrectContext && localDialRows.length === 0 ? (
                    <p className="reading-detail-field-hint reading-detail-field-hint--solo">
                      No per-dial data in this session—use <strong>Correct reading</strong> above.
                    </p>
                  ) : null}
                </>
              ) : null}

              <h3 className="reading-detail-more-modal-subtitle">Metadata</h3>
              <div className="metadata-grid">
                <div className="reading-detail-review-summary" role="region" aria-label="Manual review status">
                  <div className="reading-detail-review-summary-row">
                    <span className="label">
                      <UserCheck size={16} aria-hidden /> Manual review
                    </span>
                    <span
                      className={`reading-detail-review-summary-badge${reading.isManuallyReviewed ? ' reading-detail-review-summary-badge--yes' : ''}`}
                    >
                      {reading.isManuallyReviewed ? 'Reviewed' : 'Not yet'}
                    </span>
                  </div>
                  <p className="reading-detail-review-summary-hint">
                    {reading.isManuallyReviewed ? (
                      <>
                        Marked as manually reviewed.
                      </>
                    ) : (
                      <>
                        Not marked yet — saving as reviewer marks this session as reviewed.
                        Legacy <code>is_human_reviewed</code> is still read until migrated.
                      </>
                    )}
                  </p>
                  {reading.portalMetadataUpdatedBy ? (
                    <p className="reading-detail-review-summary-portal">
                      <strong>Portal metadata save:</strong>{' '}
                      {reading.portalMetadataUpdatedBy === userEmail
                        ? `${reading.portalMetadataUpdatedBy} (you)`
                        : reading.portalMetadataUpdatedBy}
                      <span className="reading-detail-review-summary-sub"> · from this website</span>
                    </p>
                  ) : null}
                </div>
                <div className="metadata-item">
                  <span className="label">
                    <Calendar size={16} aria-hidden /> Date of reading
                  </span>
                  <span className="value">{formatReadingShortDate(reading.dateOfReading)}</span>
                </div>
                <div className="metadata-item metadata-item--stacked">
                  <span className="label">
                    <MapPin size={16} aria-hidden /> Location
                  </span>
                  <div className="value reading-detail-location-block">
                    {reading.captureLocation?.placeLabel ? (
                      <span className="reading-detail-location-primary">{reading.captureLocation.placeLabel}</span>
                    ) : null}
                    {reading.captureLocation?.latitude != null &&
                    reading.captureLocation?.longitude != null &&
                    Number.isFinite(reading.captureLocation.latitude) &&
                    Number.isFinite(reading.captureLocation.longitude) ? (
                      <>
                        <span className="reading-detail-location-sub reading-detail-location-coords">
                          {formatLatLon(reading.captureLocation.latitude, reading.captureLocation.longitude)}
                          {reading.captureLocation.accuracyM != null
                            ? ` · ±${Math.round(reading.captureLocation.accuracyM)} m GPS`
                            : ''}
                        </span>
                        <span className="reading-detail-location-sub reading-detail-location-decimal">
                          {formatDecimalLatLon(reading.captureLocation.latitude, reading.captureLocation.longitude)}
                        </span>
                      </>
                    ) : reading.captureLocation?.coordinateLabel ? (
                      <span className="reading-detail-location-primary">
                        {reading.captureLocation.coordinateLabel}
                      </span>
                    ) : (
                      <span className="reading-detail-location-primary">
                        {captureLocationListLine(reading.captureLocation) || reading.location}
                      </span>
                    )}
                    {reading.captureLocation?.capturedAt ? (
                      <span className="reading-detail-location-sub">
                        GPS recorded {formatReadingShortDate(reading.captureLocation.capturedAt)}
                      </span>
                    ) : null}
                    {reading.captureLocation && captureLocationMapsUrl(reading.captureLocation) ? (
                      <a
                        className="reading-detail-location-map-link"
                        href={captureLocationMapsUrl(reading.captureLocation)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Maps
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="metadata-item metadata-item--stacked">
                  <span className="label">
                    <RotateCw size={16} aria-hidden /> Photo angle
                  </span>
                  <div className="value reading-detail-location-block">
                    {reading.captureDeviceTilt ? (
                      <>
                        <span className="reading-detail-location-primary">
                          Roll {formatTiltDegrees(reading.captureDeviceTilt.rollDeg)} · Pitch{' '}
                          {formatTiltDegrees(reading.captureDeviceTilt.pitchDeg)}
                        </span>
                        <span className="reading-detail-location-sub">
                          {captureDeviceTiltLevelLabel(reading.captureDeviceTilt)}
                          {reading.captureDeviceTilt.capturedAt
                            ? ` · ${formatReadingShortDate(reading.captureDeviceTilt.capturedAt)}`
                            : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="reading-detail-location-primary">Not recorded</span>
                        <span className="reading-detail-location-sub">
                          {captureDeviceTiltUnavailableReason(reading.imageSource)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="metadata-item metadata-item--stacked">
                  <span className="label">
                    <Compass size={16} aria-hidden /> Meter facing
                  </span>
                  <div className="value reading-detail-location-block">
                    {reading.captureCompass ? (
                      <>
                        <span className="reading-detail-location-primary">
                          {meterFacingPrimaryLabel(reading.captureCompass)}
                        </span>
                        <span className="reading-detail-location-sub">
                          {[
                            cameraFacingSubLabel(reading.captureCompass),
                            reading.captureCompass.capturedAt
                              ? formatReadingShortDate(reading.captureCompass.capturedAt)
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="reading-detail-location-primary">Not recorded</span>
                        <span className="reading-detail-location-sub">
                          {captureCompassUnavailableReason(reading.imageSource)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="metadata-item">
                  <span className="label">
                    {reading.type === 'simulator' ? <Monitor size={16} aria-hidden /> : <Radio size={16} aria-hidden />}{' '}
                    Source
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
                {reading.uploadMode ? (
                  <div className="metadata-item">
                    <span className="label">Upload mode</span>
                    <span className="value">{formatUploadModeLabel(reading.uploadMode)}</span>
                  </div>
                ) : null}
                {reading.imageSource ? (
                  <div className="metadata-item">
                    <span className="label">Image source</span>
                    <span className="value" style={{ textTransform: 'capitalize' }}>
                      {reading.imageSource}
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="reading-detail-field-hint reading-detail-more-modal-full-id">
                Full session id: <code>{reading.id}</code>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {meterPhotosOpen && hasMeterPhotos ? (
        <MeterPhotosLightbox
          slides={meterPhotoSlides}
          index={meterPhotoIndex}
          sessionId={reading.id}
          onClose={() => setMeterPhotosOpen(false)}
          onIndexChange={setMeterPhotoIndex}
        />
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
