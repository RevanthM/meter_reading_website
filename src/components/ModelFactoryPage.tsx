import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const doc = await fetchPipelineIterations();
      setRows(doc.iterations.length ? doc.iterations : []);
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

  const filteredRows = useMemo(() => {
    const list = [...rows].sort((a, b) => {
      const pa = a.pipeline.localeCompare(b.pipeline);
      if (pa !== 0) return pa;
      return a.iterationNumber - b.iterationNumber;
    });
    if (stageFilter === 'all') return list;
    return list.filter((r) => inferFactoryStage(r) === stageFilter);
  }, [rows, stageFilter]);

  const openAdd = () => {
    setModalDraft(newEmptyRow());
    setModalOpen(true);
  };

  const openEdit = (r: PipelineIterationRecord) => {
    setModalDraft(cloneRow(r));
    setModalOpen(true);
  };

  const commitModalRow = (row: PipelineIterationRecord) => {
    setRows((prev) => {
      const ix = prev.findIndex((x) => x.id === row.id);
      if (ix === -1) return [...prev, row];
      const next = [...prev];
      next[ix] = row;
      return next;
    });
  };

  const advanceStage = (r: PipelineIterationRecord) => {
    const cur = inferFactoryStage(r);
    const nxt = nextFactoryStage(cur);
    if (!nxt) return;
    const legacy = factoryStageToLegacyStatus(nxt);
    setRows((prev) =>
      prev.map((x) =>
        x.id === r.id
          ? {
              ...x,
              factoryStage: nxt,
              currentStatus: legacy.currentStatus,
              subStatus: legacy.subStatus,
            }
          : x,
      ),
    );
  };

  const handleSaveS3 = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const doc = await savePipelineIterations(userEmail || undefined, rows);
      setRows(doc.iterations);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
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
          <div className="model-factory-cards">
            {filteredRows.map((r) => {
              const stage = inferFactoryStage(r);
              const line = inferProductLine(r.modelId);
              const nxt = nextFactoryStage(stage);
              const rf = r.roboflowLinks;
              return (
                <article key={r.id} className="model-factory-card">
                  <header className="model-factory-card-head">
                    <div>
                      <h2>
                        {r.pipeline || 'Unnamed'} <span className="model-factory-card-iter">#{r.iterationNumber}</span>
                      </h2>
                      <p className="model-factory-card-sub">
                        <code>{r.modelId || '—'}</code> · {productLineDisplay(line)} · {r.appVersion || '—'}
                      </p>
                    </div>
                    <span className={`model-factory-stage-pill model-factory-stage-pill--${stage}`}>
                      {factoryStageLabel(stage)}
                    </span>
                  </header>

                  <div className="model-factory-card-chips">
                    {shipChips(r).map((c) => (
                      <span key={c} className="model-factory-ship-chip">
                        {c}
                      </span>
                    ))}
                  </div>

                  <ul className="model-factory-card-facts">
                    <li>
                      <span className="k">Images</span>
                      <span className="v">{r.imageCount ?? r.portalStats?.totalImages ?? '—'}</span>
                    </li>
                    <li>
                      <span className="k">Unit tests</span>
                      <span className="v">{r.linkedUnitTests?.length ? `${r.linkedUnitTests.length} CSV` : '—'}</span>
                    </li>
                    <li>
                      <span className="k">Roboflow</span>
                      <span className="v">
                        {rf?.dialDetection?.datasetSlug || rf?.keypoint?.datasetSlug
                          ? [
                              rf.dialDetection ? `Dial v${rf.dialDetection.version ?? '?'}` : null,
                              rf.keypoint ? `KP v${rf.keypoint.version ?? '?'}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <span className="k">Weights</span>
                      <span className="v">
                        {[
                          r.modelWeights?.dialDetection ? 'Dial .pt' : null,
                          r.modelWeights?.keypoint ? 'KP .pt' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </li>
                  </ul>

                  {r.scope ? <p className="model-factory-card-scope">{r.scope}</p> : null}

                  <footer className="model-factory-card-actions">
                    <button type="button" className="view-button" onClick={() => openEdit(r)}>
                      Edit
                    </button>
                    {nxt ? (
                      <button type="button" className="view-button" onClick={() => advanceStage(r)}>
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
                  </footer>
                </article>
              );
            })}
            {!filteredRows.length ? (
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
        readings={filteredReadings}
        workType={workType}
        dataSource={dataSource}
        factoryMode
      />
    </div>
  );
};

export default ModelFactoryPage;
