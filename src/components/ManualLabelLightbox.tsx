import { useCallback, useEffect, useRef, useState, type FC, type WheelEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { S3MeterReading } from '../services/api';
import { formatReadingShortDate } from '../utils/readingDisplayDates';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.35;

type ManualLabelLightboxProps = {
  reading: S3MeterReading;
  imageUrl: string;
  index: number;
  total: number;
  draft: string;
  reviewed: boolean;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onSaveAndNext?: () => void | Promise<void>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
};

const ManualLabelLightbox: FC<ManualLabelLightboxProps> = ({
  reading,
  imageUrl,
  index,
  total,
  draft,
  reviewed,
  saving,
  onDraftChange,
  onSave,
  onSaveAndNext,
  onClose,
  onPrev,
  onNext,
  canPrev,
  canNext,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [reading.id, imageUrl, resetView]);

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
      if (zoom <= 1 || (e.target as HTMLElement).closest('button, input')) return;
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

  const day = formatReadingShortDate(reading.dateOfReading || '');
  const canSave = draft.length === 4 && !saving && !reviewed;

  return (
    <div
      className="lightbox manual-label-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer and label"
      onClick={onClose}
    >
      <div className="manual-label-lightbox-shell" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="manual-label-lightbox-close" onClick={onClose} aria-label="Close">
          <X size={22} aria-hidden />
        </button>

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
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <img src={imageUrl} alt="Meter image" draggable={false} />
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
                aria-label="Previous image"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrev();
                }}
              >
                <ChevronLeft size={26} />
              </button>
              <button
                type="button"
                className="manual-label-lightbox-nav manual-label-lightbox-nav--next"
                disabled={!canNext}
                aria-label="Next image"
                onClick={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
              >
                <ChevronRight size={26} />
              </button>
            </>
          ) : null}
        </div>

        <aside className="manual-label-lightbox-panel" onClick={(e) => e.stopPropagation()}>
          <p className="manual-label-lightbox-panel-count">
            Image {index + 1} of {total}
          </p>
          {day ? <p className="manual-label-lightbox-panel-date">{day}</p> : null}
          <span className={`manual-label-status-pill ${reviewed ? 'is-reviewed' : 'is-new'}`}>
            {reviewed ? 'Reviewed' : 'New'}
          </span>

          {reviewed ? (
            <p className="manual-label-lightbox-reviewed">
              <Check size={18} aria-hidden />
              <span className="manual-label-done-value">
                {String(reading.expectedValue ?? '').replace(/\D/g, '')}
              </span>
            </p>
          ) : (
            <>
              <label className="manual-label-input-wrap manual-label-input-wrap--lightbox">
                <span className="manual-label-input-label">Correct reading</span>
                <input
                  className="manual-label-input manual-label-input--lightbox"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  value={draft}
                  disabled={saving}
                  autoFocus
                  onChange={(e) => onDraftChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSave) onSave();
                  }}
                />
              </label>
              <button
                type="button"
                className="manual-label-save-btn manual-label-save-btn--lightbox"
                disabled={!canSave}
                onClick={onSave}
              >
                {saving ? <Loader2 size={18} className="spin" aria-hidden /> : null}
                {saving ? 'Saving…' : 'Save label'}
              </button>
            </>
          )}

          {total > 1 && !reviewed && onSaveAndNext ? (
            <button
              type="button"
              className="manual-upload-secondary-btn manual-label-lightbox-skip"
              disabled={!canSave}
              onClick={() => void onSaveAndNext()}
            >
              Save &amp; next →
            </button>
          ) : null}
        </aside>
      </div>
    </div>
  );
};

export default ManualLabelLightbox;
