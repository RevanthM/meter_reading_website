import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Navigate, Link, useOutletContext } from 'react-router-dom';
import { ArrowLeft, GraduationCap, Loader2, Download, Upload, Link2 } from 'lucide-react';
import type { FC } from 'react';
import {
  fetchTrainingDatasets,
  downloadTrainingDatasetZip,
  uploadTrainingDatasetWeights,
  fetchTrainingWeightsSignedUrl,
  type TrainingDatasetRow,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { folderPrefixToSegment } from '../utils/trainingPipeline';

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
  { label: 'new', statusPath: 'incorrect_new' },
  { label: 'wrong', statusPath: 'incorrect-queues' },
  { label: 'correct', statusPath: 'correct' },
  { label: 'analyzed', statusPath: 'incorrect_analyzed' },
  { label: 'labeled', statusPath: 'incorrect_labeled' },
  { label: 'train', statusPath: 'incorrect_training' },
  { label: 'nodials', statusPath: 'no_dials' },
  { label: 'unsure', statusPath: 'not_sure' },
];

const TrainingPipelinePage: FC = () => {
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
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
  const [weightsMsg, setWeightsMsg] = useState<string | null>(null);
  const weightsInputRef = useRef<HTMLInputElement>(null);

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
      if (!found) setLoadError('Pipeline not found. It may have been removed.');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed.');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [segment]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await uploadTrainingDatasetWeights(row.folderPrefix, weightsFile);
      setWeightsFile(null);
      if (weightsInputRef.current) weightsInputRef.current.value = '';
      await load();
      setWeightsMsg('Saved to S3 as model/weights.pt and recorded in dataset.json.');
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
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/training')}>
            <ArrowLeft size={20} />
            <span>Training</span>
          </button>
          <div className="page-title">
            <GraduationCap size={32} strokeWidth={1.5} />
            <div>
              <h1>{row?.displayName ?? 'pipeline'}</h1>
              <p>
                Copy rows into this folder, download a session ZIP for Roboflow, train, then attach <strong>weights.pt</strong>{' '}
                here → same bucket <code>model/weights.pt</code> for the iOS app. Pipeline id: <code>{segment}</code>
              </p>
            </div>
          </div>
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
            <section className="training-pipeline-actions">
              <button
                type="button"
                className="training-pipeline-zip-btn"
                onClick={() => void handleZip()}
                disabled={zipBusy}
              >
                {zipBusy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
                {zipBusy ? 'ZIP…' : 'download zip'}
              </button>
            </section>

            <section className="training-pipeline-weights" aria-labelledby="pipeline-weights-title">
              <h2 id="pipeline-weights-title" className="training-pipeline-add-title">
                weights.pt (iOS)
              </h2>
              <p className="training-pipeline-add-lead">
                Stored in this bucket at <code>model/weights.pt</code> under this pipeline. The training ZIP above skips
                this file so exports stay small.
              </p>
              {row.weights?.uploadedAt ? (
                <p className="training-pipeline-weights-meta">
                  Current file:{' '}
                  <strong>{row.weights.originalFileName ?? 'weights.pt'}</strong> ·{' '}
                  {formatBytes(row.weights.sizeBytes ?? undefined)} · uploaded {row.weights.uploadedAt}
                </p>
              ) : (
                <p className="training-pipeline-weights-meta">No weights uploaded yet.</p>
              )}
              <div className="training-pipeline-weights-row">
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
              {weightsMsg ? <p className="training-pipeline-weights-toast">{weightsMsg}</p> : null}
            </section>

            <section className="training-pipeline-add">
              <h2 className="training-pipeline-add-title">add images</h2>
              <p className="training-pipeline-add-lead">Open a list (same tabs as below). Your pipeline stays selected.</p>
              <nav className="training-pipeline-tabs" aria-label="Reading folders">
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
          </>
        ) : null}
      </main>
    </div>
  );
};

export default TrainingPipelinePage;
