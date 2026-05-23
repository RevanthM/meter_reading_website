import { useCallback, useEffect, useMemo, useRef, useState, type FC, type WheelEvent } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  approveSessionForUnitTest,
  fetchReadingById,
  patchSessionMetadata,
  removeSessionFromTestDataset,
  type ImageDifficulty,
  type S3MeterReading,
} from '../services/api';
import type { WorkType } from '../types';
import { concatDialDigitsFromRows, reconcileDialRowsForReading } from '../utils/dialDetails';
import { formatSessionIdForDisplay } from '../utils/sessionDisplay';
import { confirmRemoveFromTestDataset } from '../utils/testDataRemoveConfirm';
import {
  dialDigitsFromExpected,
  expectedFromDialDigits,
  meterDialCountFromExpected,
  normalizeDialDigit,
  normalizeUnitTestDifficulty,
} from '../utils/unitTestImageNaming';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.35;

const DIFFICULTY_OPTIONS: { value: ImageDifficulty; label: string }[] = [
  { value: 'normal', label: 'Normal (d1)' },
  { value: 'difficult', label: 'Difficult (d2)' },
  { value: 'very_difficult', label: 'Very difficult (d3)' },
];

type Props = {
  workType: WorkType;
  items: S3MeterReading[];
  index: number;
  imageUrl: string;
  userEmail?: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onReadingUpdated: (reading: S3MeterReading) => void;
  onReadingRemoved: (sessionId: string) => void;
  onReadingApproved: (sessionId: string) => void;
};

const TestDataPendingLightbox: FC<Props> = ({
  workType,
  items,
  index,
  imageUrl,
  userEmail,
  onClose,
  onIndexChange,
  onReadingUpdated,
  onReadingRemoved,
  onReadingApproved,
}) => {
  const listItem = items[index];
  const total = items.length;
  const canPrev = index > 0;
  const canNext = index < total - 1;

  const [reading, setReading] = useState<S3MeterReading | null>(listItem ?? null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [dialDigits, setDialDigits] = useState<number[]>([]);
  const [imageDifficulty, setImageDifficulty] = useState<ImageDifficulty>('normal');
  const [comments, setComments] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const dialRows = useMemo(
    () => (reading ? reconcileDialRowsForReading(reading) : []),
    [reading],
  );

  const composedReading = useMemo(() => expectedFromDialDigits(dialDigits), [dialDigits]);
  const meterDialCount = dialDigits.length || meterDialCountFromExpected(composedReading);

  const syncFormFromReading = useCallback((row: S3MeterReading) => {
    const expected = (row.expectedValue ?? row.meterValue ?? '').trim();
    const rows = reconcileDialRowsForReading(row);
    const fromRows = concatDialDigitsFromRows(rows);
    setDialDigits(
      fromRows.length >= 4
        ? dialDigitsFromExpected(fromRows)
        : dialDigitsFromExpected(expected || fromRows),
    );
    setImageDifficulty(normalizeUnitTestDifficulty(row.imageDifficulty));
    setComments(row.comments ?? '');
  }, []);

  useEffect(() => {
    if (!listItem) return;
    setReading(listItem);
    syncFormFromReading(listItem);
    setLoadingDetail(true);
    void fetchReadingById(listItem.id, (listItem.workType || workType) as WorkType, listItem.s3SessionPrefix)
      .then((fresh) => {
        if (fresh) {
          setReading(fresh);
          syncFormFromReading(fresh);
        }
      })
      .finally(() => setLoadingDetail(false));
  }, [listItem, syncFormFromReading, workType]);

  const baselineExpected = (reading?.expectedValue ?? reading?.meterValue ?? '').trim();
  const baselineDifficulty = normalizeUnitTestDifficulty(reading?.imageDifficulty);
  const baselineComments = (reading?.comments ?? '').trim();

  const isDirty =
    reading != null &&
    (composedReading.trim() !== baselineExpected ||
      normalizeUnitTestDifficulty(imageDifficulty) !== baselineDifficulty ||
      comments.trim() !== baselineComments);

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [reading?.id, imageUrl, resetView]);

  const zoomIn = useCallback(() => {
    setZoom((z) => clampZoom(z + ZOOM_STEP));
  }, [clampZoom]);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = clampZoom(z - ZOOM_STEP);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, [clampZoom]);

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setZoom((z) => {
        const next = clampZoom(z + delta);
        if (next <= 1) setPan({ x: 0, y: 0 });
        return next;
      });
    },
    [clampZoom],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (zoom <= 1 || (e.target as HTMLElement).closest('button, select, input, label, textarea')) return;
      panStart.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pan.x, pan.y, zoom],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStart.current) return;
    const dx = e.clientX - panStart.current.px;
    const dy = e.clientY - panStart.current.py;
    setPan({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
  }, []);

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panStart.current) {
      panStart.current = null;
      setPanning(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onStageDoubleClick = useCallback(() => {
    if (zoom > 1) {
      resetView();
    } else {
      setZoom(2);
    }
  }, [resetView, zoom]);

  const handleDialChange = (dialIndex: number, digit: number) => {
    setDialDigits((prev) => {
      const next = [...prev];
      const count = meterDialCount;
      while (next.length < count) next.push(0);
      next[dialIndex] = normalizeDialDigit(digit);
      return next.slice(0, count);
    });
  };

  const performSave = async (): Promise<S3MeterReading | null> => {
    if (!reading?.id || !reading.s3SessionPrefix) {
      window.alert('Session folder prefix is missing; cannot save.');
      return null;
    }
    const next = composedReading.trim();
    if (!next) {
      window.alert('Set the correct meter reading using the dials.');
      return null;
    }

    const patchDialDetails =
      dialRows.length > 0
        ? dialRows.map((row, i) => ({
            ...row,
            prediction: normalizeDialDigit(dialDigits[i] ?? row.prediction),
          }))
        : dialDigits.map((digit, i) => ({
            dial: i + 1,
            prediction: normalizeDialDigit(digit),
            direction: 'clockwise',
            confidence: 1,
          }));

    setSaving(true);
    try {
      const wt = (reading.workType || workType) as WorkType;
      const saved = await patchSessionMetadata(
        reading.id,
        wt,
        {
          s3SessionPrefix: reading.s3SessionPrefix,
          patch: {
            user_correction: next,
            ml_prediction: next,
            dial_details: patchDialDetails,
            image_difficulty: normalizeUnitTestDifficulty(imageDifficulty),
            portal_review_notes: comments.trim(),
          },
        },
        userEmail,
        'test_data_reviewer',
      );
      setReading(saved);
      syncFormFromReading(saved);
      onReadingUpdated(saved);
      return saved;
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => void performSave();

  const handleApprove = async () => {
    if (!reading?.id) return;
    setApproving(true);
    try {
      if (isDirty) {
        const saved = await performSave();
        if (!saved) return;
      }
      const wt = (reading.workType || workType) as WorkType;
      const res = await approveSessionForUnitTest(
        reading.id,
        wt,
        userEmail,
        reading.s3SessionPrefix,
      );
      onReadingApproved(reading.id);
      window.alert(`Approved — unit test image ${res.fileName} uploaded.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!reading?.id || !reading.s3SessionPrefix) return;
    if (!confirmRemoveFromTestDataset(reading)) return;
    setRejecting(true);
    try {
      if (isDirty) {
        const saved = await performSave();
        if (!saved) return;
      }
      const wt = (reading.workType || workType) as WorkType;
      await removeSessionFromTestDataset(reading.id, wt, userEmail, reading.s3SessionPrefix);
      onReadingRemoved(reading.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setRejecting(false);
    }
  };

  const goToSibling = useCallback(
    (delta: -1 | 1) => {
      if (isDirty) {
        const ok = window.confirm('Discard unsaved changes and go to another session?');
        if (!ok) return;
      }
      onIndexChange(index + delta);
    },
    [index, isDirty, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && canPrev) goToSibling(-1);
      if (e.key === 'ArrowRight' && canNext) goToSibling(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canNext, canPrev, goToSibling, onClose]);

  const busy = saving || approving || rejecting || loadingDetail;

  if (!listItem || !imageUrl) return null;

  return (
    <div
      className="lightbox manual-label-lightbox unit-test-image-lightbox test-data-pending-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${formatSessionIdForDisplay(listItem.id)}`}
      onClick={onClose}
    >
      <div
        className="manual-label-lightbox-shell unit-test-image-lightbox-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="unit-test-image-lightbox-toolbar">
          <button type="button" className="manual-label-lightbox-close" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden />
          </button>
        </div>

        <div
          ref={stageRef}
          className={`manual-label-lightbox-stage${panning ? ' is-panning' : ''}${zoom <= 1 ? ' can-zoom-in' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onDoubleClick={onStageDoubleClick}
        >
          <div
            className="manual-label-lightbox-img-wrap"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <img src={imageUrl} alt="" draggable={false} />
          </div>

          <div className="manual-label-lightbox-zoom-toolbar" aria-label="Zoom controls">
            <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
              <ZoomOut size={18} />
            </button>
            <span className="manual-label-lightbox-zoom-pct">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
              <ZoomIn size={18} />
            </button>
            <button type="button" onClick={resetView} aria-label="Reset zoom" title="Reset view">
              <RotateCcw size={16} />
            </button>
          </div>
          <p className="manual-label-lightbox-hint">Scroll to zoom · drag when zoomed · double-click reset</p>

          {total > 1 ? (
            <>
              <button
                type="button"
                className="manual-label-lightbox-nav manual-label-lightbox-nav--prev"
                disabled={!canPrev || busy}
                aria-label="Previous session"
                onClick={(e) => {
                  e.stopPropagation();
                  goToSibling(-1);
                }}
              >
                <ChevronLeft size={26} />
              </button>
              <button
                type="button"
                className="manual-label-lightbox-nav manual-label-lightbox-nav--next"
                disabled={!canNext || busy}
                aria-label="Next session"
                onClick={(e) => {
                  e.stopPropagation();
                  goToSibling(1);
                }}
              >
                <ChevronRight size={26} />
              </button>
            </>
          ) : null}
        </div>

        <aside
          className="manual-label-lightbox-panel unit-test-image-lightbox-panel test-data-pending-lightbox-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="manual-label-lightbox-panel-count">
            Session {index + 1} of {total}
          </p>
          <p className="unit-test-image-lightbox-filename test-data-pending-lightbox-session">
            {formatSessionIdForDisplay(reading?.id ?? listItem.id)}
          </p>
          {loadingDetail ? (
            <p className="test-data-pending-lightbox-loading">
              <Loader2 size={16} className="spin" aria-hidden /> Loading session…
            </p>
          ) : null}

          <fieldset className="reading-detail-radio-group unit-test-image-lightbox-difficulty">
            <legend>Difficulty</legend>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <label key={opt.value} className="reading-detail-radio">
                <input
                  type="radio"
                  name="pending-lightbox-difficulty"
                  checked={imageDifficulty === opt.value}
                  disabled={busy}
                  onChange={() => setImageDifficulty(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </fieldset>

          {dialDigits.length > 0 ? (
            <div
              className="unit-test-dial-row unit-test-image-lightbox-dials"
              style={{ ['--dial-cols' as string]: String(meterDialCount) }}
            >
              {Array.from({ length: meterDialCount }, (_, i) => (
                <div key={i} className="unit-test-dial-cell">
                  <span className="unit-test-dial-label">Dial {i + 1}</span>
                  <select
                    className="image-dial-strip-digit-select"
                    aria-label={`Digit for dial ${i + 1}`}
                    value={normalizeDialDigit(dialDigits[i] ?? 0)}
                    disabled={busy}
                    onChange={(e) => handleDialChange(i, parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: 10 }, (_, d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : null}

          <p className="unit-test-image-lightbox-reading-preview" aria-live="polite">
            Reading: <strong>{composedReading || '—'}</strong>
          </p>

          <label className="test-data-pending-lightbox-notes">
            <span>Notes</span>
            <textarea
              rows={2}
              value={comments}
              disabled={busy}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Optional review notes"
            />
          </label>

          <div className="test-data-pending-lightbox-actions">
            <button
              type="button"
              className={`save-button manual-label-save-btn--lightbox ${!isDirty ? 'saved' : ''}`}
              disabled={!isDirty || busy}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 size={18} className="spin" aria-hidden /> : <Save size={18} aria-hidden />}
              {saving ? 'Saving…' : isDirty ? 'Save edits' : 'Saved'}
            </button>
            <button
              type="button"
              className="reading-detail-tdr-approve-btn"
              disabled={busy || reading?.reviewerDatasetDestination !== 'test'}
              onClick={() => void handleApprove()}
            >
              {approving ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
              Approve
            </button>
            <button
              type="button"
              className="test-data-remove-btn test-data-pending-lightbox-reject-btn"
              disabled={busy}
              onClick={() => void handleReject()}
            >
              {rejecting ? <Loader2 size={18} className="spin" /> : <XCircle size={18} />}
              Reject
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default TestDataPendingLightbox;
