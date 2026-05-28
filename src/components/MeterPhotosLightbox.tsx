import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, X } from 'lucide-react';
import type { MeterImage } from '../types';
import { downloadUrlAsFile } from '../services/api';

export type MeterPhotoSlide = {
  image: MeterImage;
  kind: 'guided' | 'full';
  label: string;
};

type Props = {
  slides: MeterPhotoSlide[];
  index: number;
  sessionId: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

const MeterPhotosLightbox: FC<Props> = ({ slides, index, sessionId, onClose, onIndexChange }) => {
  const slide = slides[index];
  const [downloading, setDownloading] = useState(false);

  const guidedIndex = useMemo(() => slides.findIndex((s) => s.kind === 'guided'), [slides]);
  const fullIndex = useMemo(() => slides.findIndex((s) => s.kind === 'full'), [slides]);

  const selectView = useCallback(
    (kind: 'guided' | 'full') => {
      const targetIndex = kind === 'guided' ? guidedIndex : fullIndex;
      if (targetIndex >= 0) onIndexChange(targetIndex);
    },
    [fullIndex, guidedIndex, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && guidedIndex >= 0) selectView('guided');
      if (e.key === 'ArrowRight' && fullIndex >= 0) selectView('full');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullIndex, guidedIndex, onClose, selectView]);

  const handleDownload = async () => {
    if (!slide) return;
    const fileName =
      slide.image.fileName ||
      `${sessionId}-${slide.kind === 'full' ? 'full_meter' : 'guided'}.jpg`;
    setDownloading(true);
    try {
      await downloadUrlAsFile(slide.image.url, fileName);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  if (!slide) return null;

  return createPortal(
    <div
      className="meter-photos-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Meter photos"
      onClick={onClose}
    >
      <div className="meter-photos-lightbox-shell" onClick={(e) => e.stopPropagation()}>
        <header className="meter-photos-lightbox-header">
          <p className="meter-photos-lightbox-title">Meter photos</p>
          <div className="meter-photos-lightbox-header-actions">
            <nav className="meter-photos-lightbox-view-tabs" aria-label="Photo view">
              <button
                type="button"
                className={`meter-photos-lightbox-view-tab${
                  slide.kind === 'guided' ? ' meter-photos-lightbox-view-tab--active' : ''
                }`}
                disabled={guidedIndex < 0}
                aria-pressed={slide.kind === 'guided'}
                onClick={() => selectView('guided')}
              >
                Guided
              </button>
              <button
                type="button"
                className={`meter-photos-lightbox-view-tab${
                  slide.kind === 'full' ? ' meter-photos-lightbox-view-tab--active' : ''
                }`}
                disabled={fullIndex < 0}
                aria-pressed={slide.kind === 'full'}
                onClick={() => selectView('full')}
              >
                Full meter
              </button>
            </nav>
            <button
              type="button"
              className="meter-photos-lightbox-download-btn"
              onClick={() => void handleDownload()}
              disabled={downloading}
              title={`Download ${slide.label}`}
              aria-label={`Download ${slide.label}`}
            >
              {downloading ? (
                <Loader2 size={18} className="spin" aria-hidden />
              ) : (
                <Download size={18} aria-hidden />
              )}
              Download
            </button>
            <button
              type="button"
              className="meter-photos-lightbox-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={22} aria-hidden />
            </button>
          </div>
        </header>

        <div className="meter-photos-lightbox-stage">
          <img src={slide.image.url} alt={slide.label} draggable={false} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default MeterPhotosLightbox;
