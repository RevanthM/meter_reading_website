import { useCallback, useEffect, useState, type FC } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import {
  syncTrainingDatasetToRoboflow,
  TRAINING_DATASET_ROBOFLOW_ANNOTATION,
  type TrainingDatasetRoboflowTraining,
  type TrainingDatasetRow,
} from '../services/api';
import { fetchRoboflowStatus } from '../services/roboflowApi';

type Props = {
  row: TrainingDatasetRow;
  onUpdated: () => void | Promise<void>;
};

const TrainingDatasetRoboflowPanel: FC<Props> = ({ row, onUpdated }) => {
  const rf = row.roboflowTraining;
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [rfErr, setRfErr] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const st = await fetchRoboflowStatus();
        setConfigured(st.configured);
        if (!st.configured) {
          setRfErr(
            'Roboflow is not configured on the server. Add ROBOFLOW_API_KEY to src/.env and restart the API.',
          );
        } else {
          setRfErr(null);
        }
      } catch (e) {
        setConfigured(false);
        setRfErr(e instanceof Error ? e.message : 'Roboflow status check failed');
      }
    })();
  }, []);

  const handleSync = useCallback(async () => {
    if (!row.folderPrefix) return;
    setSyncBusy(true);
    setMsg(null);
    try {
      const res = await syncTrainingDatasetToRoboflow(row.folderPrefix, 'train');
      setMsg(
        `Synced ${res.uploaded} original.jpg file(s) to Roboflow${res.failed ? ` (${res.failed} failed)` : ''}.`,
      );
      await onUpdated();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  }, [onUpdated, row.folderPrefix]);

  const disabled = configured !== true;

  if (!rf) {
    return (
      <section
        className="training-pipeline-bar training-pipeline-bar--roboflow"
        aria-labelledby="training-dataset-rf-title"
      >
        <h2 id="training-dataset-rf-title" className="training-pipeline-bar-title">
          Roboflow
        </h2>
        <p className="training-pipeline-bar-hint">
          Creating a Roboflow project from the portal is temporarily disabled — training needs{' '}
          <strong>keypoint-detection</strong> projects, which are not supported on the create API yet. Create the
          project in{' '}
          <a href="https://app.roboflow.com" target="_blank" rel="noreferrer">
            Roboflow
          </a>{' '}
          and link it here later. Model Factory trained-model links are unchanged.
        </p>
      </section>
    );
  }

  return (
    <section
      className="training-pipeline-bar training-pipeline-bar--roboflow"
      aria-labelledby="training-dataset-rf-title"
    >
      <h2 id="training-dataset-rf-title" className="training-pipeline-bar-title">
        Roboflow training dataset
      </h2>
      <p className="training-pipeline-bar-hint">
        <strong>Sync to Roboflow</strong> uploads <code>original.jpg</code> from each copied session (not dial crops).
        Portal project creation is disabled for now.
      </p>

      {configured === false || rfErr ? (
        <p className="training-hub-inline-error">{rfErr ?? 'Roboflow unavailable.'}</p>
      ) : null}

      <LinkedSummary rf={rf} />

      <div className="training-dataset-rf-sync">
        <button
          type="button"
          className="training-pipeline-zip-btn training-dataset-rf-sync-btn"
          disabled={disabled || syncBusy}
          onClick={() => void handleSync()}
        >
          {syncBusy ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          {syncBusy ? 'Syncing…' : 'Sync to Roboflow'}
        </button>
        <p className="training-pipeline-bar-hint training-dataset-rf-sync-hint">
          Uploads one <code>original.jpg</code> per session under <code>sessions/</code> into split <code>train</code>.
        </p>
      </div>

      {msg ? <p className="training-pipeline-bar-toast">{msg}</p> : null}
    </section>
  );
};

function LinkedSummary({ rf }: { rf: TrainingDatasetRoboflowTraining }) {
  const annotationLabel =
    rf.annotation === TRAINING_DATASET_ROBOFLOW_ANNOTATION || !rf.annotation
      ? 'analog gas meter'
      : rf.annotation.replace(/-/g, ' ');

  return (
    <div className="training-dataset-rf-linked">
      <p className="training-pipeline-bar-meta">
        <strong>{rf.projectName ?? 'Roboflow project'}</strong>
        {rf.projectType ? ` · ${rf.projectType}` : ''}
        {` · ${annotationLabel}`}
        {rf.lastSyncAt ? (
          <>
            {' '}
            · last sync {new Date(rf.lastSyncAt).toLocaleString()}
            {rf.lastSyncUploaded != null ? ` (${rf.lastSyncUploaded} uploaded` : ''}
            {rf.lastSyncFailed ? `, ${rf.lastSyncFailed} failed` : ''}
            {rf.lastSyncUploaded != null ? ')' : ''}
          </>
        ) : null}
      </p>
      {rf.annotateUrl ? (
        <a
          className="training-hub-text-btn training-dataset-rf-open"
          href={rf.annotateUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} aria-hidden />
          Open in Roboflow
        </a>
      ) : null}
    </div>
  );
}

export default TrainingDatasetRoboflowPanel;
