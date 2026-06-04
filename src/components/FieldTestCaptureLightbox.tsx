import { useCallback, useEffect, useMemo, useRef, useState, type FC, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FieldTestCaptureRow } from '../services/api';
import { downloadUrlAsFile, fetchReadingById } from '../services/api';
import type { WorkType } from '../types';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import { formatSessionIdForDisplay } from '../utils/sessionDisplay';
import { partitionMeterImages } from '../utils/meterImagePartition';
import { fieldTestReviewerCorrectionMeta } from '../utils/fieldTestCorrectionMeta';
import { fieldTestCaptureFromReading } from '../utils/fieldTestDisplay';
import FieldTestCorrectionMetaLines from './FieldTestCorrectionMetaLines';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.35;

type ViewKind = 'guided' | 'full';

type Props = {
  captures: FieldTestCaptureRow[];
  index: number;
  workType: WorkType;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** Shown above session id when opened from confusion matrix drill-down. */
  misreadLabel?: string;
};

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

const FieldTestCaptureLightbox: FC<Props> = ({
  captures,
  index,
  workType,
  onClose,
  onIndexChange,
  misreadLabel,
}) => {
  const cap = captures[index];
  const [displayCap, setDisplayCap] = useState<FieldTestCaptureRow | null>(cap ?? null);
  const total = captures.length;
  const canPrev = index > 0;
  const canNext = index < total - 1;
  const [resolvedFullMeterUrl, setResolvedFullMeterUrl] = useState<string | null>(null);
  const [loadingFullMeter, setLoadingFullMeter] = useState(false);

  const viewCap = displayCap ?? cap;
  const fullMeterUrl = viewCap?.fullMeterUrl || resolvedFullMeterUrl || null;
  const hasGuided = Boolean(viewCap?.url);
  const hasFull = Boolean(fullMeterUrl);

  const [viewKind, setViewKind] = useState<ViewKind>('guided');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(() => {
    if (!viewCap) return '';
    if (viewKind === 'full') return fullMeterUrl || '';
    return viewCap.url || fullMeterUrl || '';
  }, [viewCap, fullMeterUrl, viewKind]);

  useEffect(() => {
    setDisplayCap(cap ?? null);
    setResolvedFullMeterUrl(null);
    setLoadingFullMeter(false);
  }, [cap]);

  useEffect(() => {
    if (!cap?.sessionId) return;
    let cancelled = false;
    setLoadingFullMeter(true);
    void fetchReadingById(cap.sessionId, workType, cap.s3SessionPrefix)
      .then((reading) => {
        if (cancelled || !reading) return;
        const correction = fieldTestReviewerCorrectionMeta(reading);
        const { finalReading, predictedReading } = fieldTestCaptureFromReading(reading);
        if (reading.images?.length) {
          const { fullMeter } = partitionMeterImages(reading.images);
          if (fullMeter?.url) setResolvedFullMeterUrl(fullMeter.url);
        }
        setDisplayCap({
          ...cap,
          capturedBy: reading.userName || cap.capturedBy,
          finalReading: finalReading ?? cap.finalReading,
          predictedReading: predictedReading ?? cap.predictedReading,
          hadUserCorrection: correction.isCorrected,
          correctedBy: correction.correctedBy,
          correctedAt: correction.correctedAt,
          correctedOnDevice: correction.correctedOnDevice,
        });
      })
      .catch(() => {
        /* keep rollup/list metadata */
      })
      .finally(() => {
        if (!cancelled) setLoadingFullMeter(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cap, workType]);

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    setViewKind('guided');
    resetView();
  }, [cap?.sessionId, resetView]);

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
      if (zoom <= 1 || (e.target as HTMLElement).closest('button')) return;
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

  const goToSibling = useCallback(
    (delta: -1 | 1) => {
      const next = index + delta;
      if (next < 0 || next >= total) return;
      onIndexChange(next);
    },
    [index, onIndexChange, total],
  );

  const handleDownload = async () => {
    if (!viewCap || !imageUrl) return;
    const fileName =
      viewKind === 'full'
        ? `${viewCap.sessionId}-full_meter.jpg`
        : `${viewCap.sessionId}-guided.jpg`;
    setDownloading(true);
    try {
      await downloadUrlAsFile(imageUrl, fileName);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && canPrev) goToSibling(-1);
      if (e.key === 'ArrowRight' && canNext) goToSibling(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canNext, canPrev, goToSibling, onClose]);

  if (!viewCap) return null;

  const showImageStage = Boolean(imageUrl) || (viewKind === 'full' && loadingFullMeter);

  if (!showImageStage && viewKind === 'guided' && !viewCap.url && !fullMeterUrl) return null;

  return createPortal(
    <div
      className="lightbox manual-label-lightbox unit-test-image-lightbox field-test-capture-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Field test capture ${formatSessionIdForDisplay(viewCap.sessionId)}`}
      onClick={onClose}
    >
      <div
        className="manual-label-lightbox-shell unit-test-image-lightbox-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="unit-test-image-lightbox-toolbar field-test-capture-lightbox-toolbar">
          <nav className="meter-photos-lightbox-view-tabs" aria-label="Photo view">
            <button
              type="button"
              className={`meter-photos-lightbox-view-tab${
                viewKind === 'guided' ? ' meter-photos-lightbox-view-tab--active' : ''
              }`}
              disabled={!hasGuided}
              aria-pressed={viewKind === 'guided'}
              onClick={() => setViewKind('guided')}
            >
              Guided
            </button>
            <button
              type="button"
              className={`meter-photos-lightbox-view-tab${
                viewKind === 'full' ? ' meter-photos-lightbox-view-tab--active' : ''
              }`}
              disabled={!hasFull && !loadingFullMeter}
              aria-pressed={viewKind === 'full'}
              onClick={() => setViewKind('full')}
            >
              Full meter
            </button>
          </nav>
          <div className="field-test-capture-lightbox-toolbar-actions">
            <button
              type="button"
              className="manual-label-lightbox-close unit-test-image-lightbox-toolbar-btn"
              disabled={downloading}
              onClick={() => void handleDownload()}
              title="Download image"
              aria-label="Download image"
            >
              {downloading ? <Loader2 size={20} className="spin" aria-hidden /> : <Download size={20} aria-hidden />}
            </button>
            <button type="button" className="manual-label-lightbox-close" onClick={onClose} aria-label="Close">
              <X size={22} aria-hidden />
            </button>
          </div>
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
            {imageUrl ? (
              <img src={imageUrl} alt={viewKind === 'full' ? 'Full meter' : 'Guided crop'} draggable={false} />
            ) : loadingFullMeter ? (
              <p className="field-test-capture-lightbox-loading">
                <Loader2 size={28} className="spin" aria-hidden /> Loading full meter…
              </p>
            ) : null}
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
                disabled={!canPrev}
                aria-label="Previous capture"
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
                disabled={!canNext}
                aria-label="Next capture"
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
          className="manual-label-lightbox-panel unit-test-image-lightbox-panel field-test-capture-lightbox-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="manual-label-lightbox-panel-count">
            Capture {index + 1} of {total}
          </p>
          {misreadLabel ? (
            <p className="field-test-capture-lightbox-misread-label">{misreadLabel}</p>
          ) : null}
          <p className="unit-test-image-lightbox-filename">
            <code>{formatSessionIdForDisplay(viewCap.sessionId)}</code>
          </p>
          <p className="field-test-capture-lightbox-meta">
            <span className={difficultyBadgeClass(viewCap.imageDifficulty)}>
              {formatUnitTestDifficultyTag(viewCap.imageDifficulty)}
            </span>
            {viewCap.hadUserCorrection ? (
              <span className="field-test-corrected-pill">Corrected</span>
            ) : null}
          </p>
          <p className="unit-test-image-lightbox-reading-preview">
            Ground truth: <strong>{viewCap.finalReading || '—'}</strong>
          </p>
          <p className="field-test-capture-lightbox-meta-line">
            Model (raw): <strong>{viewCap.predictedReading ?? '—'}</strong>
          </p>
          <FieldTestCorrectionMetaLines
            capturedBy={viewCap.capturedBy}
            dialCount={viewCap.dialCount}
            hadUserCorrection={viewCap.hadUserCorrection}
            correctedBy={viewCap.correctedBy}
            correctedAt={viewCap.correctedAt}
            correctedOnDevice={viewCap.correctedOnDevice}
          />
          <button
            type="button"
            className="view-button unit-test-image-lightbox-download-btn"
            disabled={downloading}
            onClick={() => void handleDownload()}
          >
            {downloading ? <Loader2 size={18} className="spin" aria-hidden /> : <Download size={18} aria-hidden />}
            Download
          </button>
        </aside>
      </div>
    </div>,
    document.body,
  );
};

export default FieldTestCaptureLightbox;
