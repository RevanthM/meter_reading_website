import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Navigate, Link, useOutletContext } from 'react-router-dom';
import { ArrowLeft, GraduationCap, Loader2, Download, Upload, Link2, RefreshCw } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import type { FC } from 'react';
import {
  fetchTrainingDatasets,
  downloadTrainingDatasetZip,
  uploadTrainingDatasetWeights,
  fetchTrainingWeightsSignedUrl,
  fetchCopiedSessionsPreview,
  type TrainingDatasetRow,
  type TrainingCopiedSessionPreview,
} from '../services/api';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { folderPrefixToSegment } from '../utils/trainingPipeline';
import TrainingDatasetRoboflowPanel from './TrainingDatasetRoboflowPanel';

function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const ADD_IMAGE_TABS: { label: string; statusPath: string }[] = [
  { label: 'browse', statusPath: 'all' },
  { label: 'awaiting', statusPath: 'incorrect_new' },
  { label: 'incorrect', statusPath: 'incorrect-queues' },
  { label: 'correct', statusPath: 'correct' },
  { label: 'analyzed', statusPath: 'incorrect_analyzed' },
  { label: 'labeled', statusPath: 'incorrect_labeled' },
  { label: 'train', statusPath: 'incorrect_training' },
  { label: 'nodials', statusPath: 'no_dials' },
  { label: 'unsure', statusPath: 'not_sure' },
];

const TrainingPipelinePage: FC = () => {
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const { userEmail } = useAuth();
  if (outletCtx?.workMode === 'reviewer') {
    return <Navigate to="/" replace />;
  }

  const { segment: segmentParam } = useParams<{ segment: string }>();
  const navigate = useNavigate();
  const segment = useMemo(() => {
    if (!segmentParam) return '';
    try {
      return decodeURIComponent(segmentParam);
    } catch {
      return segmentParam;
    }
  }, [segmentParam]);

  const [row, setRow] = useState<TrainingDatasetRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zipBusy, setZipBusy] = useState(false);
  const [weightsFile, setWeightsFile] = useState<File | null>(null);
  const [weightsBusy, setWeightsBusy] = useState(false);
  const [weightsUrlBusy, setWeightsUrlBusy] = useState(false);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [weightsMsg, setWeightsMsg] = useState<string | null>(null);
  const weightsInputRef = useRef<HTMLInputElement>(null);

  const [copiedPreview, setCopiedPreview] = useState<TrainingCopiedSessionPreview[] | null>(null);
  const [copiedPreviewLoading, setCopiedPreviewLoading] = useState(false);
  const [copiedPreviewError, setCopiedPreviewError] = useState<string | null>(null);

  const loadCopiedPreview = useCallback(async (folderPrefix: string | undefined) => {
    if (!folderPrefix) {
      setCopiedPreview(null);
      setCopiedPreviewError(null);
      return;
    }
    setCopiedPreviewLoading(true);
    setCopiedPreviewError(null);
    try {
      const res = await fetchCopiedSessionsPreview(folderPrefix);
      setCopiedPreview(res.sessions);
    } catch (e) {
      setCopiedPreviewError(e instanceof Error ? e.message : 'Failed to load session previews.');
      setCopiedPreview(null);
    } finally {
      setCopiedPreviewLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!segment) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const data = await fetchTrainingDatasets();
      const found =
        data.datasets.find((d) => !d.manifestMissing && folderPrefixToSegment(d.folderPrefix) === segment) || null;
      setRow(found);
      if (!found) setLoadError('Training dataset not found. It may have been removed.');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed.');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [segment]);

  const handlePageRefresh = useCallback(async () => {
    setPageRefreshing(true);
    try {
      await load();
      if (row?.folderPrefix) await loadCopiedPreview(row.folderPrefix);
    } finally {
      setPageRefreshing(false);
    }
  }, [load, loadCopiedPreview, row?.folderPrefix]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCopiedPreview(row?.folderPrefix);
  }, [row?.folderPrefix, loadCopiedPreview]);

  const pipelineQuery = segment ? `?pipeline=${encodeURIComponent(segment)}` : '';

  const handleZip = async () => {
    if (!row?.folderPrefix) return;
    setZipBusy(true);
    try {
      await downloadTrainingDatasetZip(row.folderPrefix);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'ZIP failed.');
    } finally {
      setZipBusy(false);
    }
  };

  const handleWeightsUpload = async () => {
    if (!row?.folderPrefix || !weightsFile) return;
    setWeightsBusy(true);
    setWeightsMsg(null);
    try {
      const res = await uploadTrainingDatasetWeights(row.folderPrefix, weightsFile, userEmail);
      setWeightsFile(null);
      if (weightsInputRef.current) weightsInputRef.current.value = '';
      await load();
      const p = res.sessionPromotion;
      let extra = '';
      if (p?.enabled === false) {
        extra = ' Session auto-queue updates are disabled (TRAINING_WEIGHTS_AUTO_PROMOTE_SESSIONS).';
      } else if (p && p.moved > 0) {
        extra = ` Moved ${p.moved} session(s) to the "Added to training dataset" queue (${p.skippedAlready} already there${
          p.skippedNotInPipeline ? `, ${p.skippedNotInPipeline} skipped — not on the incorrect pipeline` : ''
        }${p.notFound ? `, ${p.notFound} not found in portal lists` : ''}${p.moveFailed ? `, ${p.moveFailed} move failed` : ''}).`;
      } else if (p && p.sessionCountConsidered > 0) {
        extra = ` No sessions moved (${p.skippedAlready} already in training queue${
          p.skippedNotInPipeline ? `, ${p.skippedNotInPipeline} not on incorrect pipeline` : ''
        }${p.notFound ? `, ${p.notFound} not found` : ''}).`;
      }
      setWeightsMsg(`Saved to S3 as model/weights.pt and recorded in dataset.json.${extra}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setWeightsBusy(false);
    }
  };

  const handleCopyWeightsUrl = async () => {
    if (!row?.folderPrefix) return;
    setWeightsUrlBusy(true);
    setWeightsMsg(null);
    try {
      const { url, expiresInSeconds } = await fetchTrainingWeightsSignedUrl(row.folderPrefix);
      await navigator.clipboard.writeText(url);
      setWeightsMsg(`HTTPS download link copied (${expiresInSeconds}s TTL). Use in iOS or curl for a quick test.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not get link.');
    } finally {
      setWeightsUrlBusy(false);
    }
  };

  if (!segmentParam) {
    return <Navigate to="/training" replace />;
  }

  return (
    <div className="detail-page training-pipeline-page">
      <header className="page-header">
        <div className="header-content training-pipeline-header list-page-header-with-actions">
          <div className="training-pipeline-header-lead list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/training')}>
              <ArrowLeft size={20} />
              <span>Training</span>
            </button>
            <div className="page-title">
              <GraduationCap size={32} strokeWidth={1.5} />
              <div>
                <h1>{row?.displayName ?? 'Training dataset'}</h1>
                <p>
                  Copy sessions into this training dataset, train in Roboflow (keypoint project — create in app for now), then attach{' '}
                  <strong>weights.pt</strong> here → same bucket <code>model/weights.pt</code> for the iOS app. Id:{' '}
                  <code>{segment}</code>
                </p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton
            onRefresh={() => void handlePageRefresh()}
            busy={pageRefreshing || loading}
            disabled={loading}
            title="Reload dataset and copied sessions"
          />
          {!loading && row ? (
            <div className="training-pipeline-header-zip" aria-labelledby="training-pipeline-zip-title">
              <h2 id="training-pipeline-zip-title" className="training-pipeline-header-zip-title">
                Download ZIP
              </h2>
              <p className="training-pipeline-header-zip-lead">
                Exports <strong>raw meter photos only</strong> (e.g. <code>original.jpg</code>, no <code>dial_*</code> crops)
                plus <code>dataset.json</code> — all at the <strong>ZIP root with no subfolders</strong> (each image is{' '}
                <code>&lt;sessionId&gt;_original.jpg</code>, etc.). <code>metadata.json</code> and <code>model/</code> are omitted.
              </p>
              <button
                type="button"
                className="training-pipeline-zip-btn training-pipeline-header-zip-btn"
                onClick={() => void handleZip()}
                disabled={zipBusy}
              >
                {zipBusy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
                {zipBusy ? 'ZIP…' : 'download zip'}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="detail-content training-pipeline-main">
        {loading ? (
          <p className="training-hub-loading">
            <Loader2 size={20} className="spin" aria-hidden /> Loading…
          </p>
        ) : null}
        {loadError ? <p className="training-hub-inline-error">{loadError}</p> : null}
        {!loading && row ? (
          <>
            <p className="sr-only" id="pipeline-weights-desc">
              Stored in this bucket at model/weights.pt under this pipeline. The training ZIP in the header skips this
              file so exports stay small. After upload, sessions copied into this pipeline may be moved to the Added to
              training dataset S3 queue when they were still on the incorrect pipeline (awaiting review to labeled);
              already-correct captures are left alone. Set TRAINING_WEIGHTS_AUTO_PROMOTE_SESSIONS=0 on the server to
              disable automatic moves.
            </p>
            <section
              className="training-pipeline-bar training-pipeline-bar--weights"
              aria-labelledby="pipeline-weights-title"
              aria-describedby="pipeline-weights-desc"
            >
              <h2 id="pipeline-weights-title" className="training-pipeline-bar-title">
                weights.pt (iOS)
              </h2>
              {row.weights?.uploadedAt ? (
                <p className="training-pipeline-bar-meta">
                  <strong>{row.weights.originalFileName ?? 'weights.pt'}</strong> ·{' '}
                  {formatBytes(row.weights.sizeBytes ?? undefined)} · {row.weights.uploadedAt}
                </p>
              ) : (
                <p className="training-pipeline-bar-meta">
                  None yet — file lives at <code>model/weights.pt</code> in this pipeline folder.
                </p>
              )}
              <div className="training-pipeline-bar-controls">
                <input
                  ref={weightsInputRef}
                  type="file"
                  accept=".pt,application/octet-stream"
                  className="training-pipeline-weights-file"
                  aria-label="Choose weights.pt file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setWeightsFile(f ?? null);
                    setWeightsMsg(null);
                  }}
                />
                <button
                  type="button"
                  className="training-pipeline-zip-btn training-pipeline-weights-upload"
                  disabled={weightsBusy || !weightsFile}
                  onClick={() => void handleWeightsUpload()}
                >
                  {weightsBusy ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
                  {weightsBusy ? 'Uploading…' : 'upload to S3'}
                </button>
                <button
                  type="button"
                  className="training-pipeline-zip-btn training-pipeline-weights-link"
                  disabled={weightsUrlBusy || !row.weights?.s3Key}
                  onClick={() => void handleCopyWeightsUrl()}
                >
                  {weightsUrlBusy ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}
                  {weightsUrlBusy ? '…' : 'copy download link'}
                </button>
              </div>
            </section>
            {weightsMsg ? <p className="training-pipeline-bar-toast">{weightsMsg}</p> : null}

            <TrainingDatasetRoboflowPanel row={row} onUpdated={load} />

            <section className="training-pipeline-bar training-pipeline-bar--queues" aria-labelledby="pipeline-add-title">
              <h2 id="pipeline-add-title" className="training-pipeline-bar-title">
                add images
              </h2>
              <p className="training-pipeline-bar-hint">
                Open a queue — the URL keeps this pipeline so you can use <strong>copy into folder</strong> from the
                readings toolbar.
              </p>
              <nav className="training-pipeline-tabs training-pipeline-tabs--bar" aria-label="Reading folders">
                {ADD_IMAGE_TABS.map((t) => (
                  <Link
                    key={t.statusPath}
                    className="training-pipeline-tab"
                    to={`/readings/${t.statusPath}${pipelineQuery}`}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
            </section>

            <section className="training-pipeline-copied" aria-labelledby="training-pipeline-copied-title">
              <div className="training-pipeline-copied-head">
                <h2 id="training-pipeline-copied-title" className="training-pipeline-copied-title">
                  Sessions in this folder
                </h2>
                <button
                  type="button"
                  className="training-pipeline-copied-refresh"
                  disabled={copiedPreviewLoading || !row.folderPrefix}
                  onClick={() => void loadCopiedPreview(row.folderPrefix)}
                  title="Refresh thumbnails"
                >
                  {copiedPreviewLoading ? (
                    <Loader2 size={16} className="spin" aria-hidden />
                  ) : (
                    <RefreshCw size={16} aria-hidden />
                  )}
                  <span>Refresh</span>
                </button>
              </div>
              <p className="training-pipeline-copied-lead">
                Rows copied from the readings list are stored under <code>sessions/&lt;session id&gt;/</code> (same
                tree as the training ZIP). Thumbnails use <strong>raw meter photos only</strong> (e.g.{' '}
                <code>original.jpg</code>), not <code>dial_*</code> model crops; counts are raw images only. Signed
                URLs expire in about an hour.
              </p>
              {copiedPreviewError ? (
                <div className="training-pipeline-copied-alert" role="alert">
                  <strong>Could not load session previews.</strong> {copiedPreviewError}
                </div>
              ) : null}
              {!copiedPreviewLoading && copiedPreview !== null && copiedPreview.length === 0 ? (
                <p className="training-pipeline-copied-empty">
                  No sessions in this folder yet. In labeler mode, select readings and use <strong>copy into folder</strong>{' '}
                  on the list toolbar, then refresh here.
                </p>
              ) : null}
              {copiedPreview !== null && copiedPreview.length > 0 ? (
                <div className="training-pipeline-copied-grid">
                  {copiedPreview.map((s) => (
                    <Link
                      key={s.sessionId}
                      className="training-pipeline-copied-card"
                      to={`/reading/${encodeURIComponent(s.sessionId)}?workType=${encodeURIComponent(workType)}`}
                    >
                      <div className="training-pipeline-copied-thumb">
                        {s.thumbUrl ? (
                          <img src={s.thumbUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="training-pipeline-copied-thumb--empty">No raw image in copy</span>
                        )}
                      </div>
                      <div className="training-pipeline-copied-meta">
                        <code>{s.sessionId}</code>
                        {s.imageCount > 0 ? <span> · {s.imageCount} raw</span> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
};

export default TrainingPipelinePage;
