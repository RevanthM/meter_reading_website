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
};

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

const FieldTestCaptureLightbox: FC<Props> = ({ captures, index, workType, onClose, onIndexChange }) => {
  const cap = captures[index];
  const total = captures.length;
  const canPrev = index > 0;
  const canNext = index < total - 1;
  const [resolvedFullMeterUrl, setResolvedFullMeterUrl] = useState<string | null>(null);
  const [loadingFullMeter, setLoadingFullMeter] = useState(false);

  const fullMeterUrl = cap?.fullMeterUrl || resolvedFullMeterUrl || null;
  const hasGuided = Boolean(cap?.url);
  const hasFull = Boolean(fullMeterUrl);

  const [viewKind, setViewKind] = useState<ViewKind>('guided');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(() => {
    if (!cap) return '';
    if (viewKind === 'full') return fullMeterUrl || '';
    return cap.url || fullMeterUrl || '';
  }, [cap, fullMeterUrl, viewKind]);

  useEffect(() => {
    setResolvedFullMeterUrl(null);
    setLoadingFullMeter(false);
  }, [cap?.sessionId]);

  useEffect(() => {
    if (!cap?.sessionId || cap.fullMeterUrl) return;
    let cancelled = false;
    setLoadingFullMeter(true);
    void fetchReadingById(cap.sessionId, workType, cap.s3SessionPrefix)
      .then((reading) => {
        if (cancelled || !reading?.images?.length) return;
        const { fullMeter } = partitionMeterImages(reading.images);
        if (fullMeter?.url) setResolvedFullMeterUrl(fullMeter.url);
      })
      .catch(() => {
        /* list/detail may be unavailable — tab stays disabled */
      })
      .finally(() => {
        if (!cancelled) setLoadingFullMeter(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cap?.fullMeterUrl, cap?.s3SessionPrefix, cap?.sessionId, workType]);

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
    if (!cap || !imageUrl) return;
    const fileName =
      viewKind === 'full'
        ? `${cap.sessionId}-full_meter.jpg`
        : `${cap.sessionId}-guided.jpg`;
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

  if (!cap) return null;

  const showImageStage = Boolean(imageUrl) || (viewKind === 'full' && loadingFullMeter);

  if (!showImageStage && viewKind === 'guided' && !cap.url && !fullMeterUrl) return null;

  return createPortal(
    <div
      className="lightbox manual-label-lightbox unit-test-image-lightbox field-test-capture-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Field test capture ${formatSessionIdForDisplay(cap.sessionId)}`}
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
          <p className="unit-test-image-lightbox-filename">
            <code>{formatSessionIdForDisplay(cap.sessionId)}</code>
          </p>
          <p className="field-test-capture-lightbox-meta">
            <span className={difficultyBadgeClass(cap.imageDifficulty)}>
              {formatUnitTestDifficultyTag(cap.imageDifficulty)}
            </span>
            {cap.hadUserCorrection ? <span className="field-test-corrected-pill">Corrected</span> : null}
          </p>
          <p className="unit-test-image-lightbox-reading-preview">
            Final reading: <strong>{cap.finalReading || '—'}</strong>
          </p>
          <p className="field-test-capture-lightbox-meta-line">
            Predicted: <strong>{cap.predictedReading ?? '—'}</strong>
          </p>
          <p className="field-test-capture-lightbox-meta-line">
            {cap.capturedBy || 'Unknown'} · {cap.dialCount} reads
          </p>
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
