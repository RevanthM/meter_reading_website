import type { FC } from 'react';
import { ArrowRight, FileSpreadsheet, Loader2, Pencil, Trash2 } from 'lucide-react';
import type { PipelineIterationRecord, PipelineIterationUnitTestLink } from '../services/api';
import {
  factoryStageLabel,
  inferFactoryStage,
  inferProductLineForRow,
  nextFactoryStage,
  productLineDisplay,
} from '../constants/factoryStages';
import { pickNewestLink } from '../utils/unitTestIterationLink';
import { normalizePipelineIterationTestReadinessSubStatus } from '../constants/pipelineIterationRegistry';

function shipSubStatusPillClass(status: string): string {
  const n = normalizePipelineIterationTestReadinessSubStatus(status);
  if (n === 'Not started') return 'model-factory-substatus-pill--not-started';
  if (n === 'In progress') return 'model-factory-substatus-pill--in-progress';
  if (n === 'Completed') return 'model-factory-substatus-pill--completed';
  return '';
}

function fmtListDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export type ModelFactoryIterationRowProps = {
  row: PipelineIterationRecord;
  showNewPill?: boolean;
  saving: boolean;
  utDownloadBusy: string | null;
  onEdit: (row: PipelineIterationRecord) => void;
  onAdvance: (row: PipelineIterationRecord) => void;
  onDelete: (row: PipelineIterationRecord) => void;
  onDownloadUt: (link: PipelineIterationUnitTestLink) => void;
};

const ModelFactoryIterationRow: FC<ModelFactoryIterationRowProps> = ({
  row: r,
  showNewPill = false,
  saving,
  utDownloadBusy,
  onEdit,
  onAdvance,
  onDelete,
  onDownloadUt,
}) => {
  const stage = inferFactoryStage(r);
  const line = inferProductLineForRow(r);
  const nxt = nextFactoryStage(stage);
  const utLinks = r.linkedUnitTests ?? [];
  const primaryUt = pickNewestLink(utLinks);
  const imageCount = r.imageCount ?? r.portalStats?.totalImages ?? null;
  const imageLabel = imageCount != null ? `${imageCount} images` : '— images';
  const stageSubStatus = normalizePipelineIterationTestReadinessSubStatus(r.factoryStageSubStatus);
  const stagePill =
    stageSubStatus != null && stageSubStatus !== ''
      ? { label: factoryStageLabel(stage), status: stageSubStatus }
      : null;

  const tooltip = [
    productLineDisplay(line),
    factoryStageLabel(stage),
    r.modelId || null,
    r.updatedAt
      ? `Edited ${fmtListDate(r.updatedAt)}`
      : r.startDate
        ? `Start ${fmtListDate(r.startDate)}`
        : null,
    r.scope || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      className={`model-factory-card-mini model-factory-card-mini--${stage}`}
      data-pl={line}
      title={tooltip}
    >
      <div className="model-factory-card-mini-top">
        {line !== 'unknown' ? (
          <span className={`model-factory-card-mini-pl model-factory-card-mini-pl--${line}`}>{line}</span>
        ) : null}
        <span className="model-factory-card-mini-title">
          {r.pipeline || 'Unnamed'} <span className="model-factory-card-mini-iter">#{r.iterationNumber}</span>
        </span>
        {showNewPill ? (
          <span className="model-factory-new-pill model-factory-new-pill--mini" title="Latest deployed for this pipeline">
            New
          </span>
        ) : null}
      </div>
      {stagePill ? (
        <div className="model-factory-card-mini-chips" aria-label="Stage sub-status">
          <span
            className={`model-factory-substatus-pill ${shipSubStatusPillClass(stagePill.status)}`.trim()}
            title={`${stagePill.label}: ${stagePill.status}`}
          >
            <span className="model-factory-substatus-pill-track">{stagePill.label}</span>
            <span className="model-factory-substatus-pill-value">{stagePill.status}</span>
          </span>
        </div>
      ) : null}
      <div className="model-factory-card-mini-bottom">
        <span className="model-factory-card-mini-images">{imageLabel}</span>
        <div className="model-factory-card-mini-actions">
          {primaryUt ? (
            <button
              type="button"
              className="view-button model-factory-card-mini-btn"
              title={
                utLinks.length > 1
                  ? `Download UT CSV (${utLinks.length} linked)`
                  : `Download ${primaryUt.fileName || primaryUt.s3Key}`
              }
              disabled={utDownloadBusy === primaryUt.s3Key}
              onClick={() => onDownloadUt(primaryUt)}
            >
              {utDownloadBusy === primaryUt.s3Key ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <FileSpreadsheet size={14} />
              )}
              UT
            </button>
          ) : null}
          <button type="button" className="view-button model-factory-card-mini-btn" onClick={() => onEdit(r)}>
            <Pencil size={14} aria-hidden />
            Edit
          </button>
          {nxt ? (
            <button
              type="button"
              className="view-button model-factory-card-mini-btn"
              title={`Advance to ${factoryStageLabel(nxt)}`}
              onClick={() => onAdvance(r)}
              disabled={saving}
            >
              <ArrowRight size={14} />
              {factoryStageLabel(nxt)}
            </button>
          ) : null}
          <button
            type="button"
            className="view-button model-factory-card-mini-btn model-factory-card-mini-btn--delete"
            title="Delete"
            aria-label="Delete"
            onClick={() => onDelete(r)}
            disabled={saving}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
};

export default ModelFactoryIterationRow;
