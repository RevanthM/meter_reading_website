import { useRef, useState, type FC } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import type {
  PipelineIterationRecord,
  PipelineIterationWeightMeta,
  PipelineIterationWeightRole,
} from '../services/api';
import {
  fetchPipelineIterationWeightSignedUrl,
  pullPipelineIterationWeightFromRoboflow,
  uploadPipelineIterationWeight,
} from '../services/api';
import { fetchRoboflowVersionMeta } from '../services/roboflowApi';
import { mergeRoboflowVersionDetailIntoLink } from '../utils/roboflowLinkFields';
import { buildIterationWeightsFolderName, iterationWeightsS3Prefix } from '../utils/iterationWeightsS3';

type Props = {
  row: PipelineIterationRecord;
  setRow: React.Dispatch<React.SetStateAction<PipelineIterationRecord>>;
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ROLE_CONFIG: {
  role: PipelineIterationWeightRole;
  label: string;
  linkKey: 'dialDetection' | 'keypoint';
}[] = [
  { role: 'dial_detection', label: 'Dial detection', linkKey: 'dialDetection' },
  { role: 'keypoint', label: 'Keypoint', linkKey: 'keypoint' },
];

const FactoryIterationWeights: FC<Props> = ({ row, setRow }) => {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>({});

  const iterationId = row.id?.trim();
  const weightContext = {
    pipeline: row.pipeline,
    iterationNumber: row.iterationNumber,
    modelId: row.modelId,
  };
  const s3Folder = buildIterationWeightsFolderName(weightContext);
  const s3Prefix = iterationWeightsS3Prefix(weightContext);

  if (!iterationId) {
    return (
      <p className="pipeline-iteration-form-hint">Save the iteration once to get an id before uploading weights.</p>
    );
  }

  const applyWeight = (role: PipelineIterationWeightRole, weights: PipelineIterationWeightMeta) => {
    const field = role === 'dial_detection' ? 'dialDetection' : 'keypoint';
    setRow((r) => ({
      ...r,
      modelWeights: { ...(r.modelWeights ?? {}), [field]: weights },
    }));
  };

  const uploadFile = async (role: PipelineIterationWeightRole, file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pt')) {
      setErr('Choose a PyTorch weights file (.pt extension).');
      return;
    }
    setBusy(`upload-${role}`);
    setErr(null);
    try {
      const res = await uploadPipelineIterationWeight(iterationId, role, file, weightContext);
      applyWeight(role, res.weights);
      setPendingFiles((prev) => ({ ...prev, [role]: null }));
      const input = fileRefs.current[role];
      if (input) input.value = '';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const onFileInputChange = (role: PipelineIterationWeightRole, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFiles((prev) => ({ ...prev, [role]: file }));
    void uploadFile(role, file);
  };

  const openFilePicker = (role: PipelineIterationWeightRole) => {
    setErr(null);
    fileRefs.current[role]?.click();
  };

  const onPullRoboflow = async (role: PipelineIterationWeightRole, linkKey: 'dialDetection' | 'keypoint') => {
    const link = row.roboflowLinks?.[linkKey];
    if (!link?.datasetSlug || link.version == null) {
      setErr(`Link a Roboflow project with a version for ${linkKey === 'dialDetection' ? 'dial' : 'keypoint'} first.`);
      return;
    }
    setBusy(`rf-${role}`);
    setErr(null);
    try {
      const res = await pullPipelineIterationWeightFromRoboflow({
        iterationId,
        role,
        datasetSlug: link.datasetSlug,
        version: link.version,
        roboflowLinks: row.roboflowLinks ?? undefined,
        ...weightContext,
      });
      applyWeight(role, res.weights);
      if (res.roboflow?.modelTypeDisplay && link.version != null) {
        try {
          const meta = await fetchRoboflowVersionMeta(link.datasetSlug, link.version);
          setRow((r) => {
            const prev = r.roboflowLinks?.[linkKey];
            if (!prev) return r;
            return {
              ...r,
              roboflowLinks: {
                ...(r.roboflowLinks ?? {}),
                [linkKey]: mergeRoboflowVersionDetailIntoLink(prev, meta),
              },
            };
          });
        } catch {
          /* optional refresh */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Roboflow pull failed');
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async (role: PipelineIterationWeightRole) => {
    setBusy(`dl-${role}`);
    setErr(null);
    try {
      const { url } = await fetchPipelineIterationWeightSignedUrl(iterationId, role, weightContext);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download link failed');
    } finally {
      setBusy(null);
    }
  };

  const setRoboflowVersion = (linkKey: 'dialDetection' | 'keypoint', version: number | null) => {
    setRow((r) => {
      const prev = r.roboflowLinks?.[linkKey];
      if (!prev) return r;
      return {
        ...r,
        roboflowLinks: {
          ...(r.roboflowLinks ?? {}),
          [linkKey]: { ...prev, version },
        },
      };
    });
  };

  return (
    <fieldset className="pipeline-iteration-form-section model-factory-form-section">
      <legend>Weights (.pt)</legend>
      <p className="pipeline-iteration-form-hint">
        Click <strong>Upload weights.pt</strong> to pick a file — upload starts automatically. Or use{' '}
        <strong>Pull weights.pt</strong> from Roboflow. Save the iteration row after upload.
      </p>
      <p className="pipeline-iteration-form-hint">
        S3: <code>meter-reader-training-feedback/{s3Prefix}</code>
        <br />
        Folder: <strong>{s3Folder}</strong>
      </p>
      {err ? (
        <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
          {err}
        </p>
      ) : null}
      <div className="model-factory-weights-grid">
        {ROLE_CONFIG.map(({ role, label, linkKey }) => {
          const meta = row.modelWeights?.[linkKey];
          const link = row.roboflowLinks?.[linkKey];
          const uploading = busy === `upload-${role}`;
          const pulling = busy === `rf-${role}`;
          const downloading = busy === `dl-${role}`;
          const pending = pendingFiles[role];
          return (
            <div key={role} className="model-factory-weights-card">
              <div className="model-factory-weights-card-head">
                <strong>{label}</strong>
                {meta ? (
                  <span className="model-factory-weights-badge">
                    {meta.source === 'roboflow' ? 'Roboflow' : 'Uploaded'} · {formatBytes(meta.sizeBytes)}
                  </span>
                ) : (
                  <span className="readings-confidence-missing">No weights</span>
                )}
              </div>
              {meta?.uploadedAt ? (
                <p className="pipeline-iteration-form-hint">
                  {meta.originalFileName || 'weights.pt'} · {new Date(meta.uploadedAt).toLocaleString()}
                  {meta.s3Key ? (
                    <>
                      <br />
                      <code>{meta.s3Key}</code>
                    </>
                  ) : null}
                </p>
              ) : null}
              {link ? (
                <label className="model-factory-rf-version">
                  Roboflow version
                  <input
                    type="number"
                    min={1}
                    value={link.version ?? ''}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setRoboflowVersion(linkKey, Number.isFinite(v) && v > 0 ? v : null);
                    }}
                  />
                </label>
              ) : null}
              <div className="model-factory-weights-actions">
                <input
                  ref={(el) => {
                    fileRefs.current[role] = el;
                  }}
                  type="file"
                  accept=".pt,application/octet-stream"
                  className="model-factory-weights-file-hidden"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => onFileInputChange(role, e)}
                />
                <button
                  type="button"
                  className="training-pipeline-zip-btn model-factory-weights-upload-btn"
                  disabled={Boolean(busy)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openFilePicker(role);
                  }}
                >
                  {uploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
                  {uploading ? 'Uploading…' : 'Upload weights.pt'}
                </button>
                {pending && !uploading ? (
                  <span className="pipeline-iteration-form-hint model-factory-weights-pending">
                    {pending.name} ({formatBytes(pending.size)})
                  </span>
                ) : null}
                <button
                  type="button"
                  className="training-hub-text-btn"
                  disabled={Boolean(busy) || !link?.datasetSlug}
                  title={link?.datasetSlug ? 'Download weights.pt from Roboflow' : 'Link Roboflow project above'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onPullRoboflow(role, linkKey);
                  }}
                >
                  {pulling ? <Loader2 size={14} className="spin" /> : null}
                  Pull weights.pt
                </button>
                {meta ? (
                  <button
                    type="button"
                    className="training-hub-text-btn"
                    disabled={Boolean(busy)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onDownload(role);
                    }}
                  >
                    {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                    Download
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};

export default FactoryIterationWeights;
