import { ExternalLink, Loader2 } from 'lucide-react';
import type { FC } from 'react';
import type { PipelineIterationRoboflowVersionLink } from '../services/api';
import type { RoboflowProjectVersion } from '../services/roboflowApi';
import { formatRoboflowDate, formatRoboflowPercent } from '../utils/roboflowLinkFields';

type Props = {
  title: string;
  link: PipelineIterationRoboflowVersionLink;
  versions: RoboflowProjectVersion[];
  modelsUrl?: string;
  loading?: boolean;
  onVersionChange: (version: number) => void;
  onClear: () => void;
};

function formatOptionLabel(ver: RoboflowProjectVersion): string {
  const parts = [`Model ${ver.version}`];
  if (ver.modelId) parts.push(ver.modelId);
  else if (ver.name) parts.push(ver.name);
  if (ver.map != null && Number.isFinite(ver.map)) {
    parts.push(`mAP ${ver.map <= 1 ? (ver.map * 100).toFixed(1) : ver.map}%`);
  }
  return parts.join(' · ');
}

const RoboflowLinkDetail: FC<Props> = ({
  title,
  link,
  versions,
  modelsUrl,
  loading,
  onVersionChange,
  onClear,
}) => {
  const trained = versions.filter((v) => v.hasTrainedModel);
  const datasetOnly = versions.filter((v) => !v.hasTrainedModel);
  const splits = link.splits;
  const splitLine =
    splits && (splits.train != null || splits.valid != null || splits.test != null)
      ? `train ${splits.train ?? '—'} · valid ${splits.valid ?? '—'} · test ${splits.test ?? '—'}`
      : null;

  const modelsPage =
    modelsUrl ||
    `https://app.roboflow.com/${link.datasetSlug}/models`;

  return (
    <div className="model-factory-rf-detail">
      <div className="model-factory-rf-detail-head">
        <strong>{title}</strong>
        <span className="model-factory-rf-detail-project">{link.projectName || link.datasetSlug}</span>
        {loading ? <Loader2 size={14} className="spin" aria-label="Loading Roboflow" /> : null}
        <button type="button" className="training-hub-text-btn model-factory-rf-clear" onClick={onClear}>
          Unlink
        </button>
      </div>

      <div className="model-factory-rf-detail-controls">
        <label>
          Trained model
          <select
            value={link.version ?? ''}
            disabled={loading || !versions.length}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v > 0) onVersionChange(v);
            }}
          >
            {versions.length ? null : (
              <option value={link.version ?? ''}>Model {link.version ?? '?'}</option>
            )}
            {trained.length > 0 ? (
              <optgroup label={`Fine-tuned (${trained.length})`}>
                {trained.map((ver) => (
                  <option key={`t-${ver.version}`} value={ver.version ?? ''}>
                    {formatOptionLabel(ver)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {datasetOnly.length > 0 ? (
              <optgroup label={`Dataset versions only (${datasetOnly.length})`}>
                {datasetOnly.map((ver) => (
                  <option key={`d-${ver.version}`} value={ver.version ?? ''}>
                    v{ver.version}
                    {ver.name ? ` · ${ver.name}` : ''}
                    {' · not trained'}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <a href={modelsPage} target="_blank" rel="noreferrer" className="training-hub-text-btn">
          All models <ExternalLink size={12} />
        </a>
        <a
          href={`https://app.roboflow.com/${link.datasetSlug}`}
          target="_blank"
          rel="noreferrer"
          className="training-hub-text-btn"
        >
          Dataset <ExternalLink size={12} />
        </a>
      </div>

      {link.modelId ? (
        <p className="pipeline-iteration-form-hint">
          Model id: <code>{link.modelId}</code>
        </p>
      ) : null}
      {link.modelTypeDisplay ? (
        <p className="model-factory-rf-detail-type">{link.modelTypeDisplay}</p>
      ) : null}

      <dl className="model-factory-rf-detail-stats">
        <div>
          <dt>Images</dt>
          <dd>{link.imageCount != null ? link.imageCount.toLocaleString() : '—'}</dd>
        </div>
        {splitLine ? (
          <div className="model-factory-rf-detail-span">
            <dt>Splits</dt>
            <dd>{splitLine}</dd>
          </div>
        ) : null}
        <div>
          <dt>Last trained</dt>
          <dd>{formatRoboflowDate(link.lastTrainedAt)}</dd>
        </div>
        <div>
          <dt>Train status</dt>
          <dd>{link.trainStatus || '—'}</dd>
        </div>
        <div>
          <dt>mAP@50</dt>
          <dd>{formatRoboflowPercent(link.mapPercent)}</dd>
        </div>
        <div>
          <dt>Precision</dt>
          <dd>{formatRoboflowPercent(link.precisionPercent)}</dd>
        </div>
        <div>
          <dt>Recall</dt>
          <dd>{formatRoboflowPercent(link.recallPercent)}</dd>
        </div>
        {link.checkpoint ? (
          <div className="model-factory-rf-detail-span">
            <dt>Checkpoint</dt>
            <dd>
              <code>{link.checkpoint}</code>
            </dd>
          </div>
        ) : null}
        {link.versionName ? (
          <div className="model-factory-rf-detail-span">
            <dt>Dataset version</dt>
            <dd>{link.versionName}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
};

export default RoboflowLinkDetail;
