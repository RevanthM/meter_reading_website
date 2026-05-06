import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Navigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, GraduationCap, Loader2, FolderPlus, Plus } from 'lucide-react';
import type { FC } from 'react';
import {
  createTrainingDataset,
  fetchTrainingDatasets,
  type TrainingDatasetRow,
  type TrainingDatasetsResponse,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { folderPrefixToSegment, pipelineDetailPath } from '../utils/trainingPipeline';

const TrainingHubPage: FC = () => {
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  if (outletCtx?.workMode === 'reviewer') {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const [meta, setMeta] = useState<Pick<TrainingDatasetsResponse, 'bucket' | 'rootPrefix' | 'trainingDatasetsSegment'> | null>(
    null,
  );
  const [rows, setRows] = useState<TrainingDatasetRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const data = await fetchTrainingDatasets();
      setMeta({
        bucket: data.bucket,
        rootPrefix: data.rootPrefix,
        trainingDatasetsSegment: data.trainingDatasetsSegment,
      });
      setRows(data.datasets);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load pipelines.');
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Name your pipeline first.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createTrainingDataset(trimmed);
      setName('');
      await load();
      const seg = folderPrefixToSegment(res.folderPrefix);
      navigate(pipelineDetailPath(seg));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setCreating(false);
    }
  };

  const pipelines = rows.filter((r) => !r.manifestMissing);

  return (
    <div className="detail-page training-hub-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Home</span>
          </button>
          <div className="page-title">
            <GraduationCap size={32} strokeWidth={1.5} />
            <div>
              <h1>Training</h1>
              <p>
                Pipelines are folders in bucket <code>{meta?.bucket ?? '…'}</code> under{' '}
                <code>{meta?.trainingDatasetsSegment ?? 'training-datasets'}/</code>. Open one to add photos from the
                lists, then download a ZIP.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="detail-content training-hub-main">
        <section className="training-hub-toolbar">
          <div className="training-hub-create">
            <label className="sr-only" htmlFor="new-pipeline-name">
              New pipeline name
            </label>
            <input
              id="new-pipeline-name"
              type="text"
              className="training-hub-name-input"
              placeholder="new pipeline name"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
            />
            <button
              type="button"
              className="training-hub-create-btn"
              onClick={() => void handleCreate()}
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={18} />
                  new pipeline
                </>
              )}
            </button>
          </div>
          {createError ? <p className="training-hub-inline-error">{createError}</p> : null}
        </section>

        <section className="training-hub-listview">
          <h2 className="training-hub-list-title">pipelines</h2>
          {loading ? (
            <p className="training-hub-loading">
              <Loader2 size={20} className="spin" aria-hidden /> Loading…
            </p>
          ) : null}
          {loadError ? <p className="training-hub-inline-error">{loadError}</p> : null}
          {!loading && !loadError && pipelines.length === 0 ? (
            <p className="training-hub-empty">No pipelines yet. Create one above.</p>
          ) : null}
          {!loading && pipelines.length > 0 ? (
            <ul className="training-hub-pipeline-list">
              {pipelines.map((r) => {
                const seg = folderPrefixToSegment(r.folderPrefix);
                return (
                  <li key={r.folderPrefix}>
                    <button
                      type="button"
                      className="training-hub-pipeline-row"
                      onClick={() => navigate(pipelineDetailPath(seg))}
                    >
                      <span className="training-hub-pipeline-icon" aria-hidden>
                        <FolderPlus size={20} />
                      </span>
                      <span className="training-hub-pipeline-body">
                        <span className="training-hub-pipeline-name">{r.displayName}</span>
                        <span className="training-hub-pipeline-meta">
                          {typeof r.copiedSessionCount === 'number' ? `${r.copiedSessionCount} sessions · ` : ''}
                          {r.weights?.s3Key ? 'weights.pt · ' : ''}
                          <code>{seg}</code>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </main>
    </div>
  );
};

export default TrainingHubPage;
