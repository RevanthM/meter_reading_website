import { useCallback, useEffect, useState, type FC } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, GraduationCap, Loader2, Plus, RefreshCw, Unlink } from 'lucide-react';
import {
  fetchTrainingDatasets,
  type PipelineIterationRecord,
  type TrainingDatasetRow,
} from '../services/api';
import { folderPrefixToSegment } from '../utils/trainingPipeline';

type Props = {
  row: PipelineIterationRecord;
  setRow: React.Dispatch<React.SetStateAction<PipelineIterationRecord>>;
};

function datasetOptionLabel(d: TrainingDatasetRow): string {
  const seg = folderPrefixToSegment(d.folderPrefix);
  const sessions =
    d.copiedSessionCount != null ? ` · ${d.copiedSessionCount} session${d.copiedSessionCount === 1 ? '' : 's'}` : '';
  if (d.displayName && seg && d.displayName !== seg) {
    return `${d.displayName} (${seg})${sessions}`;
  }
  return `${d.displayName || seg}${sessions}`;
}

const FactoryIterationTrainingDatasets: FC<Props> = ({ row, setRow }) => {
  const navigate = useNavigate();
  const linked = row.linkedTrainingDatasets ?? [];
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [options, setOptions] = useState<TrainingDatasetRow[]>([]);

  const linkedPrefixes = new Set(linked.map((l) => l.folderPrefix));

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const data = await fetchTrainingDatasets();
      setOptions((data.datasets || []).filter((d) => !d.manifestMissing));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load training datasets.');
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const linkRow = (d: TrainingDatasetRow) => {
    if (linkedPrefixes.has(d.folderPrefix)) return;
    setRow((r) => ({
      ...r,
      linkedTrainingDatasets: [
        ...(r.linkedTrainingDatasets ?? []),
        {
          folderPrefix: d.folderPrefix,
          displayName: d.displayName,
          linkedAt: new Date().toISOString(),
          roboflowTraining: d.roboflowTraining ?? null,
        },
      ],
    }));
  };

  const unlink = (folderPrefix: string) => {
    setRow((r) => ({
      ...r,
      linkedTrainingDatasets: (r.linkedTrainingDatasets ?? []).filter((l) => l.folderPrefix !== folderPrefix),
    }));
  };

  const available = options.filter((d) => !linkedPrefixes.has(d.folderPrefix));

  return (
    <fieldset className="pipeline-iteration-form-section model-factory-form-section">
      <legend>Training dataset</legend>
      <p className="pipeline-iteration-form-hint">
        Portal training folders in S3 — not the Roboflow <em>trained model</em> links below. Create datasets in
        Training, then link them here.
      </p>

      {linked.length === 0 ? (
        <p className="pipeline-iteration-form-muted factory-td-empty">No training dataset linked.</p>
      ) : (
        <ul className="factory-td-linked-chips">
          {linked.map((l) => (
            <li key={l.folderPrefix} className="factory-td-chip">
              <GraduationCap size={14} aria-hidden />
              <span className="factory-td-chip-label" title={l.folderPrefix}>
                {l.displayName || folderPrefixToSegment(l.folderPrefix)}
              </span>
              <Link
                to={`/training/pipeline/${encodeURIComponent(folderPrefixToSegment(l.folderPrefix))}`}
                className="factory-td-chip-link"
                title="Open dataset"
              >
                Open
              </Link>
              {l.roboflowTraining?.annotateUrl ? (
                <a
                  href={l.roboflowTraining.annotateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="factory-td-chip-link"
                  title="Roboflow"
                >
                  <ExternalLink size={12} />
                </a>
              ) : null}
              <button
                type="button"
                className="factory-td-chip-unlink"
                aria-label="Unlink"
                onClick={() => unlink(l.folderPrefix)}
              >
                <Unlink size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {loadErr ? (
        <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
          {loadErr}
        </p>
      ) : null}

      <div className="factory-td-pick-section">
        <div className="factory-td-pick-head">
          <span className="pipeline-iteration-form-hint factory-td-pick-label">
            {loading
              ? 'Loading training datasets…'
              : available.length > 0
                ? `${available.length} dataset${available.length === 1 ? '' : 's'} available`
                : options.length > 0
                  ? 'All listed datasets are already linked'
                  : 'No training datasets in S3 yet — create one in Model Training Center'}
          </span>
          <button
            type="button"
            className="pipeline-iterations-icon-btn"
            title="Refresh list"
            disabled={loading}
            onClick={() => void loadOptions()}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {!loading && available.length > 0 ? (
          <ul className="factory-td-pick-list" aria-label="Available training datasets">
            {available.map((d) => (
              <li key={d.folderPrefix}>
                <button type="button" className="factory-td-pick-row" onClick={() => linkRow(d)}>
                  <span className="factory-td-pick-name">{datasetOptionLabel(d)}</span>
                  {d.roboflowTraining?.projectName ? (
                    <span className="factory-td-pick-meta">Roboflow: {d.roboflowTraining.projectName}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="factory-td-add-wrap">
          <button
            type="button"
            className="training-hub-text-btn factory-td-add-btn"
            onClick={() => navigate('/training')}
          >
            <Plus size={16} aria-hidden />
            Add training dataset
          </button>
        </div>
      </div>

      {loading ? (
        <p className="pipeline-iteration-form-hint">
          <Loader2 size={14} className="spin" aria-hidden /> Loading…
        </p>
      ) : null}
    </fieldset>
  );
};

export default FactoryIterationTrainingDatasets;
