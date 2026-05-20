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
import { ArrowLeft, Cpu, ImagePlus, Images, ListChecks, Loader2, Upload, X } from 'lucide-react';
import { useReadings } from '../context/ReadingsContext';
import {
  createManualUploadBulk,
  createPortalInferenceUploadBulk,
  fetchMeterInferenceStatus,
  type PortalInferenceBulkResult,
} from '../services/api';
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
  const [lastResult, setLastResult] = useState<{
    uploaded: number;
    failed: number;
    withModel?: boolean;
    samplePrediction?: string;
    modelSessions?: PortalInferenceBulkResult[];
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [inferenceReady, setInferenceReady] = useState<boolean | null>(null);
  const [inferenceModalOpen, setInferenceModalOpen] = useState(false);

  useEffect(() => {
    if (!canUpload) {
      navigate('/', { replace: true });
    }
  }, [canUpload, navigate]);

  useEffect(() => {
    let cancelled = false;
    void fetchMeterInferenceStatus()
      .then((s) => {
        if (!cancelled) setInferenceReady(s.ready);
      })
      .catch(() => {
        if (!cancelled) setInferenceReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    setInferenceModalOpen(false);
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

  const handleUpload = useCallback(
    async (runModel: boolean) => {
      setError(null);
      setLastResult(null);
      setInferenceModalOpen(false);
      if (files.length === 0) {
        setError('Choose one or more meter images.');
        return;
      }
      if (runModel && inferenceReady === false) {
        setError(
          'Model inference is not configured on this server. Set METER_DETECTION_MODEL and METER_KEYPOINT_MODEL in the API .env, or use Upload only.',
        );
        return;
      }
      setSubmitting(true);
      setProgress(
        runModel
          ? `Running model & uploading ${files.length} image${files.length === 1 ? '' : 's'}…`
          : `Uploading ${files.length} image${files.length === 1 ? '' : 's'}…`,
      );
      try {
        const res = runModel
          ? await createPortalInferenceUploadBulk({ images: files, workType, sourceType }, portalWorkMode)
          : await createManualUploadBulk({ images: files, workType, sourceType }, portalWorkMode);
        void refreshData();
        const modelResults = runModel ? res.results : undefined;
        const samplePrediction = runModel ? modelResults?.[0]?.mlPrediction : undefined;
        setLastResult({
          uploaded: res.uploaded,
          failed: res.failed,
          withModel: runModel,
          samplePrediction,
          modelSessions: modelResults,
        });
        if (runModel && res.uploaded > 0 && (modelResults?.length ?? 0) > 0) {
          setInferenceModalOpen(true);
        }
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
    },
    [files, inferenceReady, portalWorkMode, refreshData, sourceType, workType],
  );

  useEffect(() => {
    if (!inferenceModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInferenceModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inferenceModalOpen]);

  const showInferenceModal =
    inferenceModalOpen &&
    lastResult?.withModel &&
    lastResult.uploaded > 0 &&
    (lastResult.modelSessions?.length ?? 0) > 0;

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
              <p>Upload images for labeling, or run the Combined P3 model into Awaiting review</p>
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
          <p className="manual-upload-card-lead">Add one or many photos.</p>
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

        {inferenceReady === false ? (
          <div className="manual-upload-banner manual-upload-banner--warn" role="status">
            <p>
              <strong>Upload &amp; run model</strong> needs Python + detector/keypoint <code>.pt</code> paths in{' '}
              <code>src/.env</code> (<code>METER_KEYPOINT_MODEL</code>, etc.). Restart the API after editing, or
              use <strong>Upload only</strong>.
            </p>
          </div>
        ) : inferenceReady === true ? (
          <p className="reading-detail-field-hint manual-upload-inference-ok">
            Python inference is ready (Combined P3 · detector + keypoint).
          </p>
        ) : null}

        {(progress ||
          error ||
          (lastResult && lastResult.uploaded > 0 && !lastResult.withModel) ||
          (lastResult?.withModel && lastResult.failed > 0)) ? (
          <div className="manual-upload-messages">
            {progress ? <p className="manual-upload-status-line">{progress}</p> : null}
            {lastResult && lastResult.uploaded > 0 && !lastResult.withModel ? (
              <p className="manual-upload-success">
                Uploaded {lastResult.uploaded} image{lastResult.uploaded === 1 ? '' : 's'} for manual labeling.
                {lastResult.failed > 0 ? ` (${lastResult.failed} failed)` : ''}
              </p>
            ) : null}
            {lastResult?.withModel && lastResult.failed > 0 ? (
              <p className="manual-upload-error">
                {lastResult.failed} file{lastResult.failed === 1 ? '' : 's'} failed
                {lastResult.uploaded > 0 ? `; ${lastResult.uploaded} uploaded` : ''}.
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
            title={
              inferenceReady === false
                ? 'Configure METER_DETECTION_MODEL and METER_KEYPOINT_MODEL on the API server'
                : 'Run Combined P3 inference and queue in Awaiting review'
            }
            onClick={() => void handleUpload(true)}
          >
            {submitting ? <Loader2 size={18} className="spin" /> : <Cpu size={18} />}
            {submitting ? 'Working…' : `Upload & run model (${files.length || 0})`}
          </button>
          <button
            type="button"
            className="manual-upload-secondary-btn manual-upload-secondary-btn--block"
            disabled={submitting || files.length === 0}
            onClick={() => void handleUpload(false)}
          >
            {submitting ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            Upload only (label later)
          </button>

          <button
            type="button"
            className="manual-upload-secondary-btn manual-upload-secondary-btn--block"
            disabled={submitting}
            onClick={() => navigate('/manual-upload/label')}
          >
            <Images size={18} aria-hidden />
            View manual uploads
          </button>
        </footer>
        </aside>
        </div>
      </main>

      {showInferenceModal && lastResult?.modelSessions ? (
        <div
          className="manual-upload-result-modal-overlay"
          role="presentation"
          onClick={() => setInferenceModalOpen(false)}
        >
          <div
            className="manual-upload-result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-upload-result-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="manual-upload-result-modal-head">
              <h2 id="manual-upload-result-modal-title">Model predictions</h2>
              <button
                type="button"
                className="manual-upload-result-modal-close"
                aria-label="Close"
                onClick={() => setInferenceModalOpen(false)}
              >
                <X size={22} aria-hidden />
              </button>
            </header>
            <div className="manual-upload-result-modal-body">
              <p className="manual-upload-result-modal-lead">
                Uploaded {lastResult.uploaded} session{lastResult.uploaded === 1 ? '' : 's'} with location{' '}
                <strong>Portal UI</strong>.
                {lastResult.failed > 0 ? ` ${lastResult.failed} file(s) failed.` : ''}
              </p>
              <div className="manual-upload-inference-results manual-upload-inference-results--modal">
                {lastResult.modelSessions.map((session) => (
                  <article key={session.sessionId} className="manual-upload-inference-session">
                    <p className="manual-upload-inference-session-title">
                      {session.fileName ? (
                        <span className="manual-upload-inference-file">{session.fileName}</span>
                      ) : null}
                      <strong className="manual-upload-inference-reading">
                        {session.mlPrediction || '—'}
                      </strong>
                    </p>
                    {session.dialSummaries?.length ? (
                      <ul className="manual-upload-dial-digits" aria-label="Per-dial predictions">
                        {session.dialSummaries.map((d) => (
                          <li key={d.dial}>
                            Dial {d.dial}: <strong>{d.digit}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {session.dialPreviewUrls?.length ? (
                      <div
                        className="manual-upload-dial-previews"
                        role="group"
                        aria-label={`Dial crops for ${session.fileName || session.sessionId}`}
                      >
                        {session.dialPreviewUrls.map((url, i) => (
                          <figure key={`${session.sessionId}-dial-${i + 1}`}>
                            <img
                              src={url}
                              alt={`Dial ${i + 1} crop`}
                              className="manual-upload-dial-preview-img"
                            />
                            <figcaption>
                              {session.dialSummaries?.[i] != null ? session.dialSummaries[i].digit : '—'}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
            <footer className="manual-upload-result-modal-footer">
              <button
                type="button"
                className="save-button manual-upload-result-modal-cta"
                onClick={() => {
                  setInferenceModalOpen(false);
                  navigate('/readings/incorrect_new');
                }}
              >
                <ListChecks size={18} aria-hidden />
                Awaiting review
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ManualUploadPage;
