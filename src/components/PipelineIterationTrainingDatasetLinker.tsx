import { useCallback, useMemo, useState, type FC } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GraduationCap, Link2, Loader2, Unlink } from 'lucide-react';
import {
  fetchTrainingDatasets,
  type PipelineIterationTrainingDatasetLink,
  type TrainingDatasetRow,
} from '../services/api';
import { folderPrefixToSegment } from '../utils/trainingPipeline';

type Props = {
  linked: PipelineIterationTrainingDatasetLink[];
  onLinkedChange: (links: PipelineIterationTrainingDatasetLink[]) => void;
};

const PipelineIterationTrainingDatasetLinker: FC<Props> = ({ linked, onLinkedChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<TrainingDatasetRow[]>([]);

  const linkedPrefixes = useMemo(() => new Set(linked.map((l) => l.folderPrefix)), [linked]);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchTrainingDatasets();
      setDatasets((data.datasets || []).filter((d) => !d.manifestMissing));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load training datasets.');
      setDatasets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openPicker = () => {
    setPickerOpen(true);
    void loadDatasets();
  };

  const linkDataset = (row: TrainingDatasetRow) => {
    if (linkedPrefixes.has(row.folderPrefix)) return;
    onLinkedChange([
      ...linked,
      {
        folderPrefix: row.folderPrefix,
        displayName: row.displayName,
        linkedAt: new Date().toISOString(),
        roboflowTraining: row.roboflowTraining ?? null,
      },
    ]);
    setPickerOpen(false);
  };

  const unlink = (folderPrefix: string) => {
    onLinkedChange(linked.filter((l) => l.folderPrefix !== folderPrefix));
  };

  return (
    <fieldset className="pipeline-iteration-form-section">
      <legend>Linked training datasets</legend>
      <p className="pipeline-iteration-form-muted">
        Portal S3 training folders — separate from trained-model Roboflow links below. Create / sync on the
        training dataset page first if you use Roboflow.
      </p>

      {linked.length === 0 ? (
        <p className="pipeline-iteration-form-muted">No training datasets linked.</p>
      ) : (
        <ul className="pipeline-iteration-ut-linked-list">
          {linked.map((l) => (
            <li key={l.folderPrefix} className="pipeline-iteration-ut-linked-item">
              <GraduationCap size={16} aria-hidden className="pipeline-iteration-ut-linked-icon" />
              <div className="pipeline-iteration-ut-linked-body">
                <span className="pipeline-iteration-ut-linked-name" title={l.folderPrefix}>
                  {l.displayName || l.folderPrefix}
                </span>
                <span className="pipeline-iteration-ut-linked-meta">
                  {l.roboflowTraining?.projectName
                    ? `Roboflow: ${l.roboflowTraining.projectName}${
                        l.roboflowTraining.lastSyncAt
                          ? ` · synced ${new Date(l.roboflowTraining.lastSyncAt).toLocaleDateString()}`
                          : ''
                      }`
                    : 'No Roboflow project yet'}
                </span>
              </div>
              <div className="pipeline-iteration-ut-actions">
                <Link
                  className="pipeline-iterations-icon-btn"
                  to={`/training/pipeline/${encodeURIComponent(folderPrefixToSegment(l.folderPrefix))}`}
                  title="Open training dataset"
                >
                  Open
                </Link>
                {l.roboflowTraining?.annotateUrl ? (
                  <a
                    className="pipeline-iterations-icon-btn"
                    href={l.roboflowTraining.annotateUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in Roboflow"
                  >
                    <ExternalLink size={14} />
                  </a>
                ) : null}
                <button
                  type="button"
                  className="pipeline-iterations-icon-btn"
                  title="Unlink"
                  aria-label="Unlink training dataset"
                  onClick={() => unlink(l.folderPrefix)}
                >
                  <Unlink size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pipeline-iteration-ut-actions">
        <button type="button" className="training-hub-text-btn" onClick={() => openPicker()}>
          <Link2 size={14} aria-hidden />
          Link training dataset
        </button>
      </div>

      {pickerOpen ? (
        <div className="pipeline-iteration-ut-picker" role="dialog" aria-label="Pick training dataset">
          <div className="pipeline-iteration-ut-picker-head">
            <h3>Training datasets</h3>
            <button type="button" className="pipeline-iterations-icon-btn" onClick={() => setPickerOpen(false)}>
              Close
            </button>
          </div>
          {loading ? (
            <p className="pipeline-iteration-form-muted">
              <Loader2 size={16} className="spin" /> Loading…
            </p>
          ) : null}
          {loadError ? <p className="training-hub-inline-error">{loadError}</p> : null}
          {!loading && !loadError && datasets.length === 0 ? (
            <p className="pipeline-iteration-form-muted">No training datasets in S3 yet.</p>
          ) : null}
          <ul className="pipeline-iteration-td-picker-list">
            {datasets.map((d) => {
              const already = linkedPrefixes.has(d.folderPrefix);
              return (
                <li key={d.folderPrefix}>
                  <button
                    type="button"
                    className="pipeline-iteration-td-picker-row"
                    disabled={already}
                    onClick={() => linkDataset(d)}
                  >
                    <span>{d.displayName}</span>
                    <span className="pipeline-iteration-td-picker-meta">
                      {d.copiedSessionCount ?? 0} sessions
                      {d.roboflowTraining ? ' · Roboflow linked' : ''}
                      {already ? ' · already linked' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
};

export default PipelineIterationTrainingDatasetLinker;
