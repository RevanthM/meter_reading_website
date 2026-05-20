import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FC,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Images, Loader2, Upload } from 'lucide-react';
import { useReadings } from '../context/ReadingsContext';
import { createManualUploadBulk } from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';

const UPLOAD_ROLES = new Set(['reviewer', 'test_data_reviewer', 'admin']);

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
}

function filesFromDataTransfer(dt: DataTransfer): File[] {
  const out: File[] = [];
  if (dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      if (isImageFile(f)) out.push(f);
    }
  }
  if (out.length === 0 && dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f && isImageFile(f)) out.push(f);
    }
  }
  return out;
}

const ManualUploadPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType, refreshData } = useReadings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const canUpload = UPLOAD_ROLES.has(portalWorkMode);

  const [files, setFiles] = useState<File[]>([]);
  const [sourceType, setSourceType] = useState<'simulator' | 'field'>('simulator');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ uploaded: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!canUpload) {
      navigate('/', { replace: true });
    }
  }, [canUpload, navigate]);

  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const addFiles = useCallback((incoming: File[], replace = false) => {
    const images = incoming.filter(isImageFile);
    if (images.length === 0) {
      setError('Only JPEG, PNG, or WebP images are supported.');
      return;
    }
    setFiles((prev) => {
      const base = replace ? [] : prev;
      const seen = new Set(base.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const merged = [...base];
      for (const f of images) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
    setLastResult(null);
    setError(null);
  }, []);

  const onFilesChange = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      addFiles(Array.from(list), true);
    },
    [addFiles],
  );

  const openFilePicker = useCallback(() => {
    if (submitting) return;
    fileInputRef.current?.click();
  }, [submitting]);

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;
    dragDepthRef.current += 1;
    setDragOver(true);
  }, [submitting]);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, [submitting]);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragOver(false);
      if (submitting) return;
      const dropped = filesFromDataTransfer(e.dataTransfer);
      if (dropped.length === 0) {
        setError('Drop image files only (JPEG, PNG, or WebP).');
        return;
      }
      addFiles(dropped, false);
    },
    [addFiles, submitting],
  );

  const onDropzoneKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  const handleUpload = useCallback(async () => {
    setError(null);
    setLastResult(null);
    if (files.length === 0) {
      setError('Choose one or more meter images.');
      return;
    }
    setSubmitting(true);
    setProgress(`Uploading ${files.length} image${files.length === 1 ? '' : 's'}…`);
    try {
      const res = await createManualUploadBulk(
        { images: files, workType, sourceType },
        portalWorkMode,
      );
      await refreshData();
      setLastResult({ uploaded: res.uploaded, failed: res.failed });
      if (res.uploaded > 0) {
        setFiles([]);
        setProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      if (res.failed > 0 && res.uploaded === 0) {
        setError(res.errors[0]?.error || 'All uploads failed.');
      } else if (res.failed > 0) {
        setError(`${res.failed} file(s) failed; ${res.uploaded} uploaded.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    } finally {
      setSubmitting(false);
    }
  }, [files, portalWorkMode, refreshData, sourceType, workType]);

  return (
    <div className="detail-page">
      <header className="page-header">
        <div className="header-content reading-detail-header">
          <button type="button" className="back-button" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>
          <div className="page-title">
            <Upload size={32} strokeWidth={1.5} />
            <div>
              <h1>Bulk upload</h1>
              <p>Upload many images, then label them on the next screen</p>
            </div>
          </div>
        </div>
      </header>

      <main className="detail-content manual-upload-page">
        <div className="manual-upload-layout">
        <div className="manual-upload-col manual-upload-col--main">
        <section className="manual-upload-card">
          <h2 className="manual-upload-card-title">
            <ImagePlus size={20} aria-hidden /> Meter images
          </h2>
          <p className="manual-upload-card-lead">
            Add one or many photos. You will label readings on the next screen.
          </p>
          <div
            className={`manual-upload-dropzone${dragOver ? ' is-drag-over' : ''}`}
            role="button"
            tabIndex={submitting ? -1 : 0}
            aria-disabled={submitting}
            aria-label="Upload meter images. Drop files here or press Enter to browse."
            onClick={openFilePicker}
            onKeyDown={onDropzoneKeyDown}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              multiple
              disabled={submitting}
              tabIndex={-1}
              aria-hidden
              onChange={(e) => onFilesChange(e.target.files)}
            />
            <span className="manual-upload-dropzone-label">
              <ImagePlus size={36} strokeWidth={1.25} aria-hidden />
              <strong>{dragOver ? 'Drop images to add' : 'Choose files'}</strong>
              {!dragOver ? <span>or drag images here</span> : null}
              <span>JPEG / PNG · multiple files OK</span>
            </span>
          </div>
          {files.length > 0 ? (
            <div className="manual-upload-preview-block">
              <p className="manual-upload-preview-count">
                <strong>{files.length}</strong> image{files.length === 1 ? '' : 's'} selected
              </p>
              <div className="manual-upload-thumb-grid">
                {files.slice(0, 24).map((f, i) => (
                  <div key={`${f.name}-${i}`} className="manual-upload-thumb-cell">
                    <img src={previewUrls[i]} alt="" className="manual-upload-thumb" />
                  </div>
                ))}
              </div>
              {files.length > 24 ? (
                <p className="reading-detail-field-hint">Showing first 24 previews.</p>
              ) : null}
              <button
                type="button"
                className="training-hub-text-btn manual-upload-clear-btn"
                disabled={submitting}
                onClick={(e) => {
                  e.stopPropagation();
                  setFiles([]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Clear selection
              </button>
            </div>
          ) : null}
        </section>
        </div>

        <aside className="manual-upload-col manual-upload-col--side" aria-label="Upload options">
        <section className="manual-upload-card manual-upload-source-card">
          <h3 className="manual-upload-source-heading">Source</h3>
          <p className="manual-upload-source-hint">Used when sessions move to correct folders.</p>
          <div className="manual-upload-source-buttons">
            <button
              type="button"
              className={`manual-upload-source-btn ${sourceType === 'simulator' ? 'active' : ''}`}
              disabled={submitting}
              onClick={() => setSourceType('simulator')}
            >
              Simulator
            </button>
            <button
              type="button"
              className={`manual-upload-source-btn ${sourceType === 'field' ? 'active' : ''}`}
              disabled={submitting}
              onClick={() => setSourceType('field')}
            >
              Field
            </button>
          </div>
        </section>

        {(progress || error || (lastResult && lastResult.uploaded > 0)) ? (
          <div className="manual-upload-messages">
            {progress ? <p className="manual-upload-status-line">{progress}</p> : null}
            {lastResult && lastResult.uploaded > 0 ? (
              <p className="manual-upload-success">
                Uploaded {lastResult.uploaded} image{lastResult.uploaded === 1 ? '' : 's'}.
                {lastResult.failed > 0 ? ` (${lastResult.failed} failed)` : ''}
              </p>
            ) : null}
            {error ? <p className="manual-upload-error">{error}</p> : null}
          </div>
        ) : null}

        <footer className="manual-upload-footer">
          <button
            type="button"
            className="save-button manual-upload-primary-btn"
            disabled={submitting || files.length === 0}
            onClick={() => void handleUpload()}
          >
            {submitting ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            {submitting ? 'Uploading…' : `Upload ${files.length || ''} image${files.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            className="manual-upload-secondary-btn manual-upload-secondary-btn--block"
            disabled={submitting}
            onClick={() => navigate('/manual-upload/label')}
          >
            <Images size={18} aria-hidden />
            View uploaded images
          </button>
        </footer>
        </aside>
        </div>
      </main>
    </div>
  );
};

export default ManualUploadPage;
