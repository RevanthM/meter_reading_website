import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Factory,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import {
  fetchPipelineIterations,
  savePipelineIterations,
  type PipelineIterationRecord,
} from '../services/api';
import { fetchRoboflowProjects, fetchRoboflowStatus, type RoboflowProject } from '../services/roboflowApi';
import {
  FACTORY_STAGES,
  type FactoryStageId,
  factoryStageLabel,
  factoryStageToLegacyStatus,
  inferFactoryStage,
  inferProductLine,
  nextFactoryStage,
  productLineDisplay,
} from '../constants/factoryStages';
import PipelineIterationFormModal from './PipelineIterationFormModal';
import {
  iterationDeleteConfirmMessage,
  iterationEditSortKey,
  newestShippedIterationIdsByPipeline,
  removePipelineIterationRow,
  sortIterationsByEditDateDesc,
  touchIterationUpdatedAt,
  upsertPipelineIterationRow,
} from '../utils/pipelineIterationRows';

function newEmptyRow(): PipelineIterationRecord {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `row-${Date.now()}`;
  return {
    id,
    pipeline: '',
    iterationNumber: 1,
    modelId: '',
    appVersion: '',
    startDate: new Date().toISOString().slice(0, 10),
    plannedEndDate: '',
    scope: '',
    imageCount: null,
    imagesAddedSinceLastIteration: null,
    currentStatus: 'Planning',
    subStatus: '',
    outcome: '',
    portalStats: null,
    manualMetrics: {},
    linkedUnitTests: [],
    factoryStage: 'planning',
    modelShip: { dialDetection: false, keypoint: true },
    roboflowLinks: null,
    modelWeights: null,
  };
}

function cloneRow(r: PipelineIterationRecord): PipelineIterationRecord {
  return JSON.parse(JSON.stringify(r)) as PipelineIterationRecord;
}

function shipChips(row: PipelineIterationRecord): string[] {
  const ship = row.modelShip;
  const chips: string[] = [];
  if (ship?.dialDetection) chips.push('Dial finder');
  if (ship?.keypoint) chips.push('Keypoint reader');
  if (!chips.length) chips.push('Not set');
  return chips;
}

function fmtListDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const ModelFactoryPage: FC = () => {
  const navigate = useNavigate();
  const { userEmail } = useAuth();
  const { filteredReadings, workType, dataSource } = useReadings();

  const [rows, setRows] = useState<PipelineIterationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<FactoryStageId | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<PipelineIterationRecord>(() => newEmptyRow());

  const [rfConfigured, setRfConfigured] = useState(false);
  const [rfProjects, setRfProjects] = useState<RoboflowProject[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const doc = await fetchPipelineIterations();
      const list = doc.iterations.length ? doc.iterations : [];
      setRows(list);
      rowsRef.current = list;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load factory data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const st = await fetchRoboflowStatus();
        setRfConfigured(st.configured);
        if (st.configured) {
          const data = await fetchRoboflowProjects();
          setRfProjects(data.projects || []);
        }
      } catch {
        setRfConfigured(false);
      }
    })();
  }, []);

  const stageCounts = useMemo(() => {
    const m = new Map<FactoryStageId, number>();
    for (const s of FACTORY_STAGES) m.set(s.id, 0);
    for (const r of rows) {
      const st = inferFactoryStage(r);
      m.set(st, (m.get(st) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const listGroups = useMemo(() => {
    if (stageFilter !== 'all') {
      return [
        {
          stage: stageFilter,
          items: sortIterationsByEditDateDesc(rows.filter((r) => inferFactoryStage(r) === stageFilter)),
        },
      ];
    }
    const groups = FACTORY_STAGES.map((st) => ({
      stage: st.id,
      items: sortIterationsByEditDateDesc(rows.filter((r) => inferFactoryStage(r) === st.id)),
    })).filter((g) => g.items.length > 0);

    // Order stage sections by most recently edited row in each group
    return groups.sort((ga, gb) => {
      const maxA = Math.max(...ga.items.map(iterationEditSortKey), 0);
      const maxB = Math.max(...gb.items.map(iterationEditSortKey), 0);
      if (maxA !== maxB) return maxB - maxA;
      const ia = FACTORY_STAGES.findIndex((s) => s.id === ga.stage);
      const ib = FACTORY_STAGES.findIndex((s) => s.id === gb.stage);
      return ia - ib;
    });
  }, [rows, stageFilter]);

  const newestShippedIds = useMemo(
    () =>
      newestShippedIterationIdsByPipeline(rows, (r) => inferFactoryStage(r) === 'shipped'),
    [rows],
  );

  const openAdd = () => {
    setModalDraft(newEmptyRow());
    setModalOpen(true);
  };

  const openEdit = (r: PipelineIterationRecord) => {
    setModalDraft(cloneRow(r));
    setModalOpen(true);
  };

  const persistIterations = useCallback(
    async (iterations: PipelineIterationRecord[]) => {
      setSaving(true);
      setSaveError(null);
      try {
        const doc = await savePipelineIterations(userEmail || undefined, iterations);
        setRows(doc.iterations);
        rowsRef.current = doc.iterations;
        return doc;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Save failed';
        setSaveError(msg);
        throw new Error(msg);
      } finally {
        setSaving(false);
      }
    },
    [userEmail],
  );

  const commitModalRow = async (row: PipelineIterationRecord) => {
    const next = upsertPipelineIterationRow(rowsRef.current, touchIterationUpdatedAt(row));
    setRows(next);
    rowsRef.current = next;
    await persistIterations(next);
  };

  const advanceStage = async (r: PipelineIterationRecord) => {
    const cur = inferFactoryStage(r);
    const nxt = nextFactoryStage(cur);
    if (!nxt) return;
    const legacy = factoryStageToLegacyStatus(nxt);
    const next = rowsRef.current.map((x) =>
      x.id === r.id
        ? touchIterationUpdatedAt({
            ...x,
            factoryStage: nxt,
            currentStatus: legacy.currentStatus,
            subStatus: legacy.subStatus,
          })
        : x,
    );
    setRows(next);
    rowsRef.current = next;
    try {
      await persistIterations(next);
    } catch {
      /* saveError banner */
    }
  };

  const handleSaveS3 = async () => {
    try {
      await persistIterations(rowsRef.current);
    } catch {
      /* saveError banner */
    }
  };

  const deleteIteration = async (row: PipelineIterationRecord) => {
    if (!window.confirm(iterationDeleteConfirmMessage(row))) return;
    const next = removePipelineIterationRow(rowsRef.current, row.id);
    setRows(next);
    rowsRef.current = next;
    if (modalOpen && modalDraft.id === row.id) {
      setModalOpen(false);
    }
    try {
      await persistIterations(next);
    } catch {
      /* saveError banner */
    }
  };

  return (
    <div className="readings-list-page model-factory-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Home</span>
          </button>
          <div className="page-title">
            <Factory size={32} strokeWidth={1.5} />
            <div>
              <h1>Model factory</h1>
              <p>
                End-to-end pipeline: data → labeling → training → model ready → test → shipped. Same registry as{' '}
                <button type="button" className="training-hub-text-btn" onClick={() => navigate('/pipeline-iterations')}>
                  pipeline iterations
                </button>
                .
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="list-content model-factory-main">
        {loadError ? (
          <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
            {loadError}
          </p>
        ) : null}
        {saveError ? (
          <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
            {saveError}
          </p>
        ) : null}

        <section className="model-factory-line" aria-label="Assembly line">
          <button
            type="button"
            className={`model-factory-line-station${stageFilter === 'all' ? ' model-factory-line-station--active' : ''}`}
            onClick={() => setStageFilter('all')}
          >
            <span className="model-factory-line-label">All</span>
            <span className="model-factory-line-count">{rows.length}</span>
          </button>
          {FACTORY_STAGES.map((st, i) => (
            <div key={st.id} className="model-factory-line-connector-wrap">
              {i > 0 ? <span className="model-factory-line-arrow" aria-hidden /> : null}
              <button
                type="button"
                className={`model-factory-line-station${stageFilter === st.id ? ' model-factory-line-station--active' : ''}`}
                onClick={() => setStageFilter(st.id)}
              >
                <span className="model-factory-line-label">{st.short}</span>
                <span className="model-factory-line-count">{stageCounts.get(st.id) ?? 0}</span>
              </button>
            </div>
          ))}
        </section>

        <div className="model-factory-toolbar">
          <button type="button" className="view-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button type="button" className="view-button" onClick={() => navigate('/training')}>
            <Layers size={16} />
            Training hub
          </button>
          <button type="button" className="view-button" onClick={openAdd}>
            <Plus size={16} />
            New iteration
          </button>
          <button type="button" className="save-button" onClick={() => void handleSaveS3()} disabled={saving || loading}>
            {saving ? <Loader2 size={18} className="spin" /> : <Save size={18} />}
            Save to S3
          </button>
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader2 size={40} className="spin" />
            <p>Loading factory…</p>
          </div>
        ) : (
          <div className="model-factory-list">
            {listGroups.map((group) => (
              <section key={group.stage} className="model-factory-list-group" aria-label={factoryStageLabel(group.stage)}>
                {stageFilter === 'all' ? (
                  <h2 className={`model-factory-list-group-title model-factory-list-group-title--${group.stage}`}>
                    {factoryStageLabel(group.stage)}
                    <span className="model-factory-list-group-count">{group.items.length}</span>
                  </h2>
                ) : null}
                <ul className="model-factory-list-rows">
                  {group.items.map((r) => {
                    const stage = inferFactoryStage(r);
                    const line = inferProductLine(r.modelId);
                    const nxt = nextFactoryStage(stage);
                    const rf = r.roboflowLinks;
                    const rfLabel =
                      rf?.dialDetection?.datasetSlug || rf?.keypoint?.datasetSlug
                        ? [
                            rf.dialDetection ? `Dial v${rf.dialDetection.version ?? '?'}` : null,
                            rf.keypoint ? `KP v${rf.keypoint.version ?? '?'}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : '—';
                    return (
                      <li key={r.id} className={`model-factory-list-row model-factory-list-row--${stage}`}>
                        <div
                          className="model-factory-list-date"
                          title={
                            r.updatedAt
                              ? `Last edited ${fmtListDate(r.updatedAt)} · Planned start ${fmtListDate(r.startDate)}`
                              : `Planned start ${fmtListDate(r.startDate)}`
                          }
                        >
                          <span className="model-factory-list-date-label">
                            {r.updatedAt ? 'Edited' : 'Start'}
                          </span>
                          <time dateTime={(r.updatedAt || r.startDate) || undefined}>
                            {fmtListDate(r.updatedAt || r.startDate)}
                          </time>
                        </div>
                        <div className="model-factory-list-main">
                          <div className="model-factory-list-head">
                            <h3>
                              {r.pipeline || 'Unnamed'}{' '}
                              <span className="model-factory-card-iter">#{r.iterationNumber}</span>
                              {stage === 'shipped' && newestShippedIds.has(r.id) ? (
                                <span className="model-factory-new-pill" title="Latest shipped for this pipeline">
                                  New
                                </span>
                              ) : null}
                            </h3>
                            <span className={`model-factory-stage-pill model-factory-stage-pill--${stage}`}>
                              {factoryStageLabel(stage)}
                            </span>
                          </div>
                          <p className="model-factory-list-meta">
                            <code>{r.modelId || '—'}</code> · {productLineDisplay(line)} · {r.appVersion || '—'}
                          </p>

                          <div className="model-factory-list-chips">
                    {shipChips(r).map((c) => (
                      <span key={c} className="model-factory-ship-chip">
                        {c}
                      </span>
                    ))}
                          </div>
                          <dl className="model-factory-list-facts">
                            <div>
                              <dt>Images</dt>
                              <dd>{r.imageCount ?? r.portalStats?.totalImages ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>Unit tests</dt>
                              <dd>{r.linkedUnitTests?.length ? `${r.linkedUnitTests.length} CSV` : '—'}</dd>
                            </div>
                            <div>
                              <dt>Roboflow</dt>
                              <dd>{rfLabel}</dd>
                            </div>
                            <div>
                              <dt>Weights</dt>
                              <dd>
                                {[
                                  r.modelWeights?.dialDetection ? 'Dial .pt' : null,
                                  r.modelWeights?.keypoint ? 'KP .pt' : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </dd>
                            </div>
                          </dl>
                          {r.scope ? <p className="model-factory-list-scope">{r.scope}</p> : null}
                        </div>
                        <div className="model-factory-list-actions">
                          <button
                            type="button"
                            className={`view-button model-factory-list-edit model-factory-list-edit--${stage}`}
                            onClick={() => openEdit(r)}
                          >
                            Edit · {factoryStageLabel(stage)}
                          </button>
                    {nxt ? (
                      <button type="button" className="view-button" onClick={() => void advanceStage(r)} disabled={saving}>
                        <ArrowRight size={14} />
                        {factoryStageLabel(nxt)}
                      </button>
                    ) : null}
                    {rfConfigured && rf?.keypoint?.datasetSlug ? (
                      <a
                        href={`https://app.roboflow.com/${rf.keypoint.datasetSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="roboflow-hub-link"
                      >
                        Roboflow <ExternalLink size={12} />
                      </a>
                    ) : null}
                          <button
                            type="button"
                            className="view-button model-factory-list-delete"
                            title="Delete iteration"
                            aria-label={`Delete ${r.pipeline || 'iteration'} #${r.iterationNumber}`}
                            onClick={() => void deleteIteration(r)}
                            disabled={saving}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {!listGroups.length ? (
              <p className="pipeline-iterations-empty">
                {rows.length ? 'No iterations in this stage.' : 'No iterations yet — create one to start the line.'}
              </p>
            ) : null}
          </div>
        )}

        {rfConfigured && rfProjects.length > 0 ? (
          <section className="model-factory-rf-ref">
            <h2>Roboflow projects</h2>
            <p className="pipeline-iteration-form-hint">
              Link projects to an iteration in <strong>Edit</strong>. p1 = Anica, p2 = Sempra, p3 = Hybrid.
            </p>
            <div className="model-factory-rf-chips">
              {rfProjects.slice(0, 12).map((p) => (
                <span key={p.datasetSlug} className="model-factory-rf-chip" title={p.type || ''}>
                  {p.name}
                  {p.type ? ` · ${p.type}` : ''}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <PipelineIterationFormModal
        open={modalOpen}
        initial={modalDraft}
        onClose={() => setModalOpen(false)}
        onSave={commitModalRow}
        onDelete={
          rows.some((x) => x.id === modalDraft.id)
            ? () => deleteIteration(modalDraft)
            : undefined
        }
        readings={filteredReadings}
        workType={workType}
        dataSource={dataSource}
        factoryMode
      />
    </div>
  );
};

export default ModelFactoryPage;
