import { useEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { WorkType } from '../types';
import type { DataSource } from '../context/ReadingsContext';
import type { S3MeterReading, PipelineIterationRecord, PipelineIterationManualMetrics } from '../services/api';
import {
  PIPELINE_ITERATION_PRIMARY_STATUSES,
  PIPELINE_ITERATION_SUB_STATUSES,
  normalizePipelineIterationPrimaryStatus,
} from '../constants/pipelineIterationRegistry';
import {
  computePortalStatsForAppVersion,
  uniqueAppVersionsFromReadings,
} from '../utils/pipelineIterationStats';
import PipelineIterationUnitTestLinker from './PipelineIterationUnitTestLinker';
import FactoryFormExtras from './FactoryFormExtras';
import { inferFactoryStage } from '../constants/factoryStages';

function deepCloneRow(r: PipelineIterationRecord): PipelineIterationRecord {
  return JSON.parse(JSON.stringify(r)) as PipelineIterationRecord;
}

function fmtPct01(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function fmtPct100(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${x.toFixed(1)}%`;
}

function emptyManual(): PipelineIterationManualMetrics {
  return {};
}

function manualNumInput(
  mm: PipelineIterationManualMetrics,
  setManual: (p: Partial<PipelineIterationManualMetrics>) => void,
  key: keyof PipelineIterationManualMetrics,
  label: string,
) {
  const v = mm[key];
  const num = typeof v === 'number' && Number.isFinite(v) ? v : null;
  return (
    <label>
      {label}{' '}
      <input
        type="number"
        step="0.1"
        value={num == null ? '' : String(num)}
        onChange={(e) =>
          setManual({
            [key]: e.target.value === '' ? null : parseFloat(e.target.value),
          } as Partial<PipelineIterationManualMetrics>)
        }
      />
    </label>
  );
}

type Props = {
  open: boolean;
  initial: PipelineIterationRecord;
  onClose: () => void;
  onSave: (row: PipelineIterationRecord) => void | Promise<void>;
  /** When set, shows Delete (existing row only). Should persist removal to S3. */
  onDelete?: () => void | Promise<void>;
  readings: S3MeterReading[];
  workType: WorkType;
  dataSource: DataSource;
  /** Show factory stage, ship targets, and Roboflow link fields. */
  factoryMode?: boolean;
};

const PipelineIterationFormModal: FC<Props> = ({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  readings,
  workType,
  dataSource,
  factoryMode = false,
}) => {
  const [row, setRow] = useState<PipelineIterationRecord>(() => deepCloneRow(initial));
  const [err, setErr] = useState<string | null>(null);
  const [metricsHighlight, setMetricsHighlight] = useState(false);
  const manualMetricsAnchorRef = useRef<HTMLFieldSetElement>(null);
  const modalBodyRef = useRef<HTMLFormElement>(null);

  const scrollModalBodyTo = (el: HTMLElement | null) => {
    const body = modalBodyRef.current;
    if (!body || !el) return;
    const offset = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: body.scrollTop + offset - 12, behavior: 'smooth' });
  };

  useEffect(() => {
    if (open) {
      setRow(deepCloneRow(initial));
      setErr(null);
      setSubmitting(false);
      setDeleting(false);
    }
  }, [open, initial]);

  /** Debounced: when app version is set, pull portal images / confidence / queue proxies without an extra click. */
  useEffect(() => {
    if (!open) return;
    const v = row.appVersion.trim();
    const t = window.setTimeout(() => {
      setRow((r) => {
        const cur = r.appVersion.trim();
        if (cur !== v) return r;
        if (!cur) {
          return { ...r, portalStats: null };
        }
        const stats = computePortalStatsForAppVersion(readings, cur, workType, dataSource);
        if (!stats) {
          return { ...r, portalStats: null };
        }
        return {
          ...r,
          portalStats: stats,
          imageCount: r.imageCount != null ? r.imageCount : stats.totalImages,
        };
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [open, row.appVersion, readings, workType, dataSource]);

  const versionChoices = uniqueAppVersionsFromReadings(readings);
  const mm = row.manualMetrics ?? emptyManual();

  const setManual = (patch: Partial<PipelineIterationManualMetrics>) => {
    setRow((r) => ({
      ...r,
      manualMetrics: { ...(r.manualMetrics ?? {}), ...patch },
    }));
  };

  const pullFromPortal = () => {
    const v = row.appVersion.trim();
    if (!v) {
      setErr('Enter an app version first.');
      return;
    }
    const stats = computePortalStatsForAppVersion(readings, v, workType, dataSource);
    if (!stats) {
      setErr(
        `No sessions found for app version “${v}” with current work type (${workType}) and source (${dataSource}).`,
      );
      return;
    }
    setErr(null);
    setRow((r) => ({
      ...r,
      portalStats: stats,
      imageCount: r.imageCount != null ? r.imageCount : stats.totalImages,
    }));
  };

  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const buildNormalizedRow = (): PipelineIterationRecord | null => {
    if (!row.pipeline.trim()) {
      setErr('Pipeline is required.');
      return null;
    }
    if (!Number.isFinite(row.iterationNumber) || row.iterationNumber < 1) {
      setErr('Iteration # must be at least 1.');
      return null;
    }
    if (!row.startDate.trim()) {
      setErr('Start date is required.');
      return null;
    }
    const factoryStage = factoryMode
      ? row.factoryStage?.trim() || inferFactoryStage(row)
      : row.factoryStage?.trim() || null;
    return {
      ...row,
      currentStatus: normalizePipelineIterationPrimaryStatus(row.currentStatus),
      factoryStage: factoryStage || null,
      linkedUnitTests: row.linkedUnitTests ?? [],
      manualMetrics: row.manualMetrics ?? {},
    };
  };

  const handleSave = async () => {
    setErr(null);
    const normalized = buildNormalizedRow();
    if (!normalized) return;
    setSubmitting(true);
    try {
      await onSave(normalized);
      onClose();
    } catch (saveErr) {
      setErr(saveErr instanceof Error ? saveErr.message : 'Failed to save iteration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setErr(null);
    setDeleting(true);
    try {
      await onDelete();
    } catch (deleteErr) {
      setErr(deleteErr instanceof Error ? deleteErr.message : 'Failed to delete iteration.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSave();
  };

  const busy = submitting || deleting;
  const saveLabel = submitting ? 'Saving…' : 'Save';
  const rowLabel =
    row.pipeline.trim() || row.modelId.trim()
      ? `${row.pipeline.trim() || 'Iteration'}${row.iterationNumber ? ` #${row.iterationNumber}` : ''}`
      : null;

  if (!open) return null;

  const ps = row.portalStats;

  return (
    <div
      className="pipeline-iteration-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="pipeline-iteration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-iteration-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pipeline-iteration-modal-chrome">
          <div className="pipeline-iteration-modal-head">
            <h2 id="pipeline-iteration-modal-title">Add / edit iteration</h2>
          <button
            type="button"
            className="pipeline-iteration-modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>

        <div className="pipeline-iteration-modal-sticky-actions" aria-label="Iteration actions">
          <div className="pipeline-iteration-modal-sticky-left">
            {rowLabel ? <span className="pipeline-iteration-modal-sticky-label">{rowLabel}</span> : null}
            {onDelete ? (
              <button
                type="button"
                className="view-button pipeline-iteration-modal-delete"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            ) : null}
          </div>
          <div className="pipeline-iteration-modal-sticky-right">
            <button type="button" className="back-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              form="pipeline-iteration-form"
              className="save-button"
              disabled={busy}
              title="Save iteration and sync to S3"
            >
              {saveLabel}
            </button>
          </div>
          </div>

          {err ? (
            <p
              className="pipeline-iterations-banner pipeline-iterations-banner--error pipeline-iteration-modal-sticky-error"
              role="alert"
            >
              {err}
            </p>
          ) : null}
        </div>

        <form
          id="pipeline-iteration-form"
          ref={modalBodyRef}
          className="pipeline-iteration-modal-body"
          onSubmit={handleSubmit}
        >
          {factoryMode ? <FactoryFormExtras row={row} setRow={setRow} /> : null}

          <fieldset className="pipeline-iteration-form-section">
            <legend>Iteration plan (manual)</legend>
            <div className="pipeline-iteration-form-grid">
              <label>
                Pipeline <input value={row.pipeline} onChange={(e) => setRow({ ...row, pipeline: e.target.value })} />
              </label>
              <label>
                Iteration #{' '}
                <input
                  type="number"
                  min={1}
                  value={row.iterationNumber}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      iterationNumber: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </label>
              <label>
                Model # <span className="pipeline-iteration-optional">(optional)</span>{' '}
                <input
                  value={row.modelId}
                  onChange={(e) => setRow({ ...row, modelId: e.target.value })}
                  placeholder="e.g. anica.p2"
                />
              </label>
              <label>
                App version <span className="pipeline-iteration-optional">(optional)</span>
                <input
                  list="pipeline-app-version-options"
                  value={row.appVersion}
                  onChange={(e) => setRow({ ...row, appVersion: e.target.value })}
                  placeholder="e.g. 4.10 (58)"
                />
                <datalist id="pipeline-app-version-options">
                  {versionChoices.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </label>
              <label>
                Start date{' '}
                <input
                  type="date"
                  value={(row.startDate || '').slice(0, 10)}
                  onChange={(e) => setRow({ ...row, startDate: e.target.value })}
                />
              </label>
              <label>
                Planned end{' '}
                <input
                  type="date"
                  value={row.plannedEndDate ? row.plannedEndDate.slice(0, 10) : ''}
                  onChange={(e) => setRow({ ...row, plannedEndDate: e.target.value })}
                />
              </label>
              <label className="pipeline-iteration-form-span2">
                Scope{' '}
                <textarea
                  rows={2}
                  value={row.scope}
                  onChange={(e) => setRow({ ...row, scope: e.target.value })}
                  placeholder="Training scope / notes"
                />
              </label>
              <label>
                # of images (override){' '}
                <input
                  type="number"
                  min={0}
                  value={row.imageCount == null ? '' : String(row.imageCount)}
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    setRow({ ...row, imageCount: t === '' ? null : parseInt(t, 10) || 0 });
                  }}
                />
              </label>
              <label>
                Images added since last iteration{' '}
                <input
                  type="number"
                  min={0}
                  value={row.imagesAddedSinceLastIteration == null ? '' : String(row.imagesAddedSinceLastIteration)}
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    setRow({
                      ...row,
                      imagesAddedSinceLastIteration: t === '' ? null : parseInt(t, 10) || 0,
                    });
                  }}
                />
              </label>
              {!factoryMode ? (
                <>
                  <label>
                    Current status{' '}
                    <input
                      list="pipeline-primary-status-options"
                      value={row.currentStatus}
                      onChange={(e) => setRow({ ...row, currentStatus: e.target.value })}
                      onBlur={() =>
                        setRow((r) => ({
                          ...r,
                          currentStatus: normalizePipelineIterationPrimaryStatus(r.currentStatus),
                        }))
                      }
                      placeholder="e.g. In Process"
                    />
                    <datalist id="pipeline-primary-status-options">
                      {PIPELINE_ITERATION_PRIMARY_STATUSES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Sub-status (optional){' '}
                    <input
                      list="pipeline-sub-status-options"
                      value={row.subStatus ?? ''}
                      onChange={(e) => setRow({ ...row, subStatus: e.target.value })}
                      placeholder="e.g. In Training"
                    />
                    <datalist id="pipeline-sub-status-options">
                      {PIPELINE_ITERATION_SUB_STATUSES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </label>
                </>
              ) : null}
              <label>
                Outcome <input value={row.outcome} onChange={(e) => setRow({ ...row, outcome: e.target.value })} />
              </label>
            </div>
            <p className="pipeline-iteration-form-hint">
              Metrics below use the <strong>current readings list</strong> (work type <code>{workType}</code>, source{' '}
              <code>{dataSource}</code>). Change those in the portal header / dashboard before refreshing.
            </p>
            <button type="button" className="view-button pipeline-iteration-pull-btn" onClick={pullFromPortal}>
              <RefreshCw size={16} aria-hidden />
              Load sessions &amp; images from portal
            </button>
          </fieldset>

          {ps ? (
            <fieldset className="pipeline-iteration-form-section pipeline-iteration-form-section--readonly">
              <legend>From portal (auto)</legend>
              <p className="pipeline-iteration-form-hint">
                Snapshot at {new Date(ps.pulledAt).toLocaleString()}. Queue “accuracy” is % of sessions in the{' '}
                <strong>correct</strong> folder; digit match compares <code>user_correction</code> vs{' '}
                <code>ml_prediction</code> digits (proxy only).
              </p>
              <div className="pipeline-iteration-stats-grid">
                <div><span className="k">Sessions</span><span className="v">{ps.totalSessions}</span></div>
                <div><span className="k">Total images</span><span className="v">{ps.totalImages}</span></div>
                <div><span className="k">Simulator sessions</span><span className="v">{ps.simulatorSessions}</span></div>
                <div><span className="k">Simulator images</span><span className="v">{ps.simulatorImages}</span></div>
                <div><span className="k">Field sessions</span><span className="v">{ps.fieldSessions}</span></div>
                <div><span className="k">Field images</span><span className="v">{ps.fieldImages}</span></div>
                <div><span className="k">Avg session confidence (app)</span><span className="v">{fmtPct01(ps.avgSessionConfidence)}</span></div>
                <div><span className="k">Queue correct (all)</span><span className="v">{fmtPct100(ps.queueCorrectRateAll)}</span></div>
                <div><span className="k">Queue correct (simulator)</span><span className="v">{fmtPct100(ps.queueCorrectRateSimulator)}</span></div>
                <div><span className="k">Queue correct (field)</span><span className="v">{fmtPct100(ps.queueCorrectRateField)}</span></div>
                <div><span className="k">Digit match UT (sim)</span><span className="v">{fmtPct100(ps.digitMatchUtPct)}</span></div>
                <div><span className="k">Dial 1 UT (%)</span><span className="v">{fmtPct100(ps.dial1UtPct)}</span></div>
                <div><span className="k">Dial 2 UT (%)</span><span className="v">{fmtPct100(ps.dial2UtPct)}</span></div>
                <div><span className="k">Dial 3 UT (%)</span><span className="v">{fmtPct100(ps.dial3UtPct)}</span></div>
                <div><span className="k">Dial 4 UT (%)</span><span className="v">{fmtPct100(ps.dial4UtPct)}</span></div>
                <div><span className="k">Digit match FT (field)</span><span className="v">{fmtPct100(ps.digitMatchFtPct)}</span></div>
                <div><span className="k">Dial 1 FT (%)</span><span className="v">{fmtPct100(ps.dial1FtPct)}</span></div>
                <div><span className="k">Dial 2 FT (%)</span><span className="v">{fmtPct100(ps.dial2FtPct)}</span></div>
                <div><span className="k">Dial 3 FT (%)</span><span className="v">{fmtPct100(ps.dial3FtPct)}</span></div>
                <div><span className="k">Dial 4 FT (%)</span><span className="v">{fmtPct100(ps.dial4FtPct)}</span></div>
              </div>
            </fieldset>
          ) : (
            <p className="pipeline-iteration-form-muted">No portal snapshot yet — choose app version and click “Load sessions…”.</p>
          )}

          <PipelineIterationUnitTestLinker
            workType={workType}
            modelId={row.modelId}
            linked={row.linkedUnitTests ?? []}
            onLinkedChange={(linkedUnitTests) => setRow((r) => ({ ...r, linkedUnitTests }))}
            onApplyManualMetrics={(metrics) => {
              setRow((r) => ({ ...r, manualMetrics: metrics }));
              setMetricsHighlight(true);
              window.setTimeout(() => setMetricsHighlight(false), 2600);
            }}
            onAfterApply={() => {
              scrollModalBodyTo(manualMetricsAnchorRef.current);
            }}
            onSuggestAppVersion={(appVersion) => {
              if (!row.appVersion.trim()) {
                setRow((r) => ({ ...r, appVersion }));
              }
            }}
          />

          <fieldset className="pipeline-iteration-form-section">
            <legend>Roboflow (manual)</legend>
            <div className="pipeline-iteration-form-grid">
              <label>
                Ave. bbox confidence (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.roboflowAvgBboxConfidence ?? ''}
                  onChange={(e) =>
                    setManual({
                      roboflowAvgBboxConfidence: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Ave. keypoint confidence (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.roboflowAvgKeypointConfidence ?? ''}
                  onChange={(e) =>
                    setManual({
                      roboflowAvgKeypointConfidence: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="pipeline-iteration-form-section">
            <legend>App model metrics (manual)</legend>
            <div className="pipeline-iteration-form-grid">
              <label>
                Ave. bbox confidence — app (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.appAvgBboxConfidence ?? ''}
                  onChange={(e) =>
                    setManual({ appAvgBboxConfidence: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Ave. keypoint confidence — app (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.appAvgKeypointConfidence ?? ''}
                  onChange={(e) =>
                    setManual({ appAvgKeypointConfidence: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset
            ref={manualMetricsAnchorRef}
            id="pipeline-manual-metrics-read"
            className={`pipeline-iteration-form-section${metricsHighlight ? ' pipeline-metrics--applied' : ''}`}
          >
            <legend>Read accuracy &amp; dials (manual — eval / notebook)</legend>
            <div className="pipeline-iteration-form-grid pipeline-iteration-form-grid--dense">
              <label>
                Read acc. simulator laptop (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.readAccuracySimulatorLaptop ?? ''}
                  onChange={(e) =>
                    setManual({
                      readAccuracySimulatorLaptop: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Read acc. UT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.readAccuracyUt ?? ''}
                  onChange={(e) =>
                    setManual({ readAccuracyUt: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Read acc. FT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.readAccuracyFt ?? ''}
                  onChange={(e) =>
                    setManual({ readAccuracyFt: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 1 UT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial1UtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial1UtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 2 UT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial2UtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial2UtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 3 UT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial3UtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial3UtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 4 UT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial4UtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial4UtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Read acc. FT (row) (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.readAccuracyFtRow ?? ''}
                  onChange={(e) =>
                    setManual({ readAccuracyFtRow: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 1 FT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial1FtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial1FtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 2 FT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial2FtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial2FtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 3 FT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial3FtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial3FtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
              <label>
                Dial 4 FT (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.dial4FtPct ?? ''}
                  onChange={(e) =>
                    setManual({ dial4FtPct: e.target.value === '' ? null : parseFloat(e.target.value) })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="pipeline-iteration-form-section">
            <legend>Admin — dataset splits &amp; eval summary</legend>
            <p className="pipeline-iteration-form-hint">
              Optional fields aligned with the iteration spreadsheet (UT laptop vs gallery/screen vs field counts;
              exact-reading accuracy; manual review rate).
            </p>
            <div className="pipeline-iteration-form-grid">
              <label>
                UT images — laptop (#){' '}
                <input
                  type="number"
                  min={0}
                  value={mm.unitTestImagesLaptop == null ? '' : String(mm.unitTestImagesLaptop)}
                  onChange={(e) =>
                    setManual({
                      unitTestImagesLaptop: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </label>
              <label>
                UT images — gallery / screen (#){' '}
                <input
                  type="number"
                  min={0}
                  value={mm.unitTestImagesGalleryOrScreen == null ? '' : String(mm.unitTestImagesGalleryOrScreen)}
                  onChange={(e) =>
                    setManual({
                      unitTestImagesGalleryOrScreen: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </label>
              <label>
                Field test images (#){' '}
                <input
                  type="number"
                  min={0}
                  value={mm.fieldTestImageCount == null ? '' : String(mm.fieldTestImageCount)}
                  onChange={(e) =>
                    setManual({
                      fieldTestImageCount: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </label>
              <label>
                Exact reading accuracy (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.exactReadingAccuracyPct ?? ''}
                  onChange={(e) =>
                    setManual({
                      exactReadingAccuracyPct: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Manual review rate (%){' '}
                <input
                  type="number"
                  step="0.1"
                  value={mm.manualReviewRatePct ?? ''}
                  onChange={(e) =>
                    setManual({
                      manualReviewRatePct: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="pipeline-iteration-form-section">
            <legend>Admin — per-dial accuracy (%)</legend>
            <div className="pipeline-iteration-form-grid pipeline-iteration-form-grid--dense">
              {manualNumInput(mm, setManual, 'simDial1AccuracyPct', 'Sim dial 1 acc. (%)')}
              {manualNumInput(mm, setManual, 'simDial2AccuracyPct', 'Sim dial 2 acc. (%)')}
              {manualNumInput(mm, setManual, 'simDial3AccuracyPct', 'Sim dial 3 acc. (%)')}
              {manualNumInput(mm, setManual, 'simDial4AccuracyPct', 'Sim dial 4 acc. (%)')}
              {manualNumInput(mm, setManual, 'appDial1AccuracyPct', 'App dial 1 acc. (%)')}
              {manualNumInput(mm, setManual, 'appDial2AccuracyPct', 'App dial 2 acc. (%)')}
              {manualNumInput(mm, setManual, 'appDial3AccuracyPct', 'App dial 3 acc. (%)')}
              {manualNumInput(mm, setManual, 'appDial4AccuracyPct', 'App dial 4 acc. (%)')}
            </div>
          </fieldset>

          <fieldset className="pipeline-iteration-form-section">
            <legend>Admin — per-dial confidence (%)</legend>
            <div className="pipeline-iteration-form-grid pipeline-iteration-form-grid--dense">
              {manualNumInput(mm, setManual, 'simDial1ConfidencePct', 'Sim dial 1 conf. (%)')}
              {manualNumInput(mm, setManual, 'simDial2ConfidencePct', 'Sim dial 2 conf. (%)')}
              {manualNumInput(mm, setManual, 'simDial3ConfidencePct', 'Sim dial 3 conf. (%)')}
              {manualNumInput(mm, setManual, 'simDial4ConfidencePct', 'Sim dial 4 conf. (%)')}
              {manualNumInput(mm, setManual, 'appDial1ConfidencePct', 'App dial 1 conf. (%)')}
              {manualNumInput(mm, setManual, 'appDial2ConfidencePct', 'App dial 2 conf. (%)')}
              {manualNumInput(mm, setManual, 'appDial3ConfidencePct', 'App dial 3 conf. (%)')}
              {manualNumInput(mm, setManual, 'appDial4ConfidencePct', 'App dial 4 conf. (%)')}
            </div>
          </fieldset>

        </form>
      </div>
    </div>
  );
};

export default PipelineIterationFormModal;
