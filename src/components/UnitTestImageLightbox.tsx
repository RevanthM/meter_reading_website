import { useCallback, useEffect, useMemo, useRef, useState, type FC, type WheelEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RotateCcw,
  Save,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  downloadUnitTestImage,
  updateUnitTestImageExpected,
  type ImageDifficulty,
  type UnitTestImageRow,
  type WorkType,
} from '../services/api';
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

type UnitTestImageLightboxProps = {
  workType: WorkType;
  images: UnitTestImageRow[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onImageUpdated: (previousS3Key: string, updated: UnitTestImageRow) => void;
};

const UnitTestImageLightbox: FC<UnitTestImageLightboxProps> = ({
  workType,
  images,
  index,
  onClose,
  onIndexChange,
  onImageUpdated,
}) => {
  const img = images[index];
  const imageUrl = img?.url || '';
  const total = images.length;
  const canPrev = index > 0;
  const canNext = index < total - 1;

  const [dialDigits, setDialDigits] = useState<number[]>([]);
  const [imageDifficulty, setImageDifficulty] = useState<ImageDifficulty>('normal');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const composedReading = useMemo(() => expectedFromDialDigits(dialDigits), [dialDigits]);
  const meterDialCount = dialDigits.length || meterDialCountFromExpected(img?.expectedMeterValue ?? '');

  const syncFormFromImage = useCallback((row: UnitTestImageRow) => {
    const expected = (row.expectedMeterValue ?? '').trim();
    setDialDigits(dialDigitsFromExpected(expected));
    setImageDifficulty(normalizeUnitTestDifficulty(row.imageDifficulty));
  }, []);

  useEffect(() => {
    if (!img) return;
    syncFormFromImage(img);
  }, [img, syncFormFromImage]);

  const isDirty =
    img != null &&
    (composedReading.trim() !== (img.expectedMeterValue ?? '').trim() ||
      normalizeUnitTestDifficulty(imageDifficulty) !== normalizeUnitTestDifficulty(img.imageDifficulty));

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [img?.s3Key, imageUrl, resetView]);

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
      if (zoom <= 1 || (e.target as HTMLElement).closest('button, select, input, label')) return;
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

  const handleDownload = async () => {
    if (!img) return;
    setDownloading(true);
    try {
      await downloadUnitTestImage(workType, img.s3Key, img.fileName);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    if (!img) return;
    const next = composedReading.trim();
    if (!next) {
      window.alert('Set the correct meter reading using the dials.');
      return;
    }
    const previousS3Key = img.s3Key;
    setSaving(true);
    try {
      const res = await updateUnitTestImageExpected(
        workType,
        img.s3Key,
        next,
        normalizeUnitTestDifficulty(imageDifficulty),
      );
      const updated: UnitTestImageRow = {
        ...img,
        s3Key: res.s3Key,
        fileName: res.fileName,
        expectedMeterValue: res.expectedMeterValue,
        imageDifficulty: res.imageDifficulty,
        url: res.url ?? img.url,
      };
      onImageUpdated(previousS3Key, updated);
      syncFormFromImage(updated);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const goToSibling = useCallback(
    (delta: -1 | 1) => {
      if (isDirty) {
        const ok = window.confirm('Discard unsaved changes and go to another image?');
        if (!ok) return;
      }
      onIndexChange(index + delta);
    },
    [index, isDirty, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && canPrev) goToSibling(-1);
      if (e.key === 'ArrowRight' && canNext) goToSibling(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canNext, canPrev, goToSibling, onClose]);

  if (!img || !imageUrl) return null;

  return (
    <div
      className="lightbox manual-label-lightbox unit-test-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${img.fileName}`}
      onClick={onClose}
    >
      <div className="manual-label-lightbox-shell unit-test-image-lightbox-shell" onClick={(e) => e.stopPropagation()}>
        <div className="unit-test-image-lightbox-toolbar">
          <button
            type="button"
            className="manual-label-lightbox-close unit-test-image-lightbox-toolbar-btn"
            disabled={downloading || saving}
            onClick={() => void handleDownload()}
            title={`Download ${img.fileName}`}
            aria-label={`Download ${img.fileName}`}
            aria-busy={downloading}
          >
            {downloading ? <Loader2 size={20} className="spin" aria-hidden /> : <Download size={20} aria-hidden />}
          </button>
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
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <img src={imageUrl} alt={img.fileName} draggable={false} />
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
                disabled={!canPrev || saving}
                aria-label="Previous image"
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
                disabled={!canNext || saving}
                aria-label="Next image"
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

        <aside className="manual-label-lightbox-panel unit-test-image-lightbox-panel" onClick={(e) => e.stopPropagation()}>
          <p className="manual-label-lightbox-panel-count">
            Image {index + 1} of {total}
          </p>
          <p className="unit-test-image-lightbox-filename">
            <code>{img.fileName}</code>
          </p>

          <fieldset className="reading-detail-radio-group unit-test-image-lightbox-difficulty">
            <legend>Difficulty</legend>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <label key={opt.value} className="reading-detail-radio">
                <input
                  type="radio"
                  name="unit-test-lightbox-difficulty"
                  checked={imageDifficulty === opt.value}
                  disabled={saving}
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
                    disabled={saving}
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

          <div className="unit-test-image-lightbox-actions">
            <button
              type="button"
              className="view-button unit-test-image-lightbox-download-btn"
              disabled={downloading || saving}
              onClick={() => void handleDownload()}
            >
              {downloading ? <Loader2 size={18} className="spin" aria-hidden /> : <Download size={18} aria-hidden />}
              Download
            </button>
            <button
              type="button"
              className={`save-button manual-label-save-btn--lightbox ${!isDirty ? 'saved' : ''}`}
              disabled={!isDirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 size={18} className="spin" aria-hidden /> : <Save size={18} aria-hidden />}
              {saving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default UnitTestImageLightbox;
