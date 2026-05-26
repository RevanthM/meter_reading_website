import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Factory, Layers, Loader2, Plus, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import {
  fetchPipelineIterations,
  fetchUnitTestRunDownloadUrl,
  PIPELINE_REGISTRY_UPDATED_EVENT,
  savePipelineIterations,
  type PipelineIterationRecord,
  type PipelineIterationUnitTestLink,
} from '../services/api';
import {
  columnForStage,
  FACTORY_COLUMNS,
  FACTORY_PRODUCT_LINES,
  type FactoryProductLine,
  factoryStageToLegacyStatus,
  inferFactoryStage,
  inferProductLineForRow,
  nextFactoryStage,
} from '../constants/factoryStages';
import PipelineIterationFormModal from './PipelineIterationFormModal';
import ModelFactoryIterationRow from './ModelFactoryIterationRow';
import {
  applyMay2026SpreadsheetToRegistry,
  mergeP3TrainingIterationIfMissing,
} from '../constants/pipelineIterationRegistry';
import {
  iterationDeleteConfirmMessage,
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
    readyToTestSimulatorSubStatus: '',
    readyToTestUnitTestSubStatus: '',
    outcome: '',
    portalStats: null,
    manualMetrics: {},
    linkedUnitTests: [],
    factoryStage: 'planning',
    factoryStageSubStatus: '',
    modelShip: { dialDetection: false, keypoint: true },
    roboflowLinks: null,
    modelWeights: null,
  };
}

function cloneRow(r: PipelineIterationRecord): PipelineIterationRecord {
  return JSON.parse(JSON.stringify(r)) as PipelineIterationRecord;
}

const ModelFactoryPage: FC = () => {
  const navigate = useNavigate();
  const { userEmail } = useAuth();
  const { filteredReadings, workType, dataSource, ensureReadingsLoaded } = useReadings();

  const [rows, setRows] = useState<PipelineIterationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [productLineFilter, setProductLineFilter] = useState<FactoryProductLine | 'all'>('all');
  const [utDownloadBusy, setUtDownloadBusy] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<PipelineIterationRecord>(() => newEmptyRow());

  useEffect(() => {
    if (modalOpen) void ensureReadingsLoaded();
  }, [modalOpen, ensureReadingsLoaded]);

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
    const onRegistryUpdated = () => {
      void load();
    };
    window.addEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
    return () => window.removeEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
  }, [load]);

  const rowsForView = useMemo(() => {
    if (productLineFilter === 'all') return rows;
    return rows.filter((r) => inferProductLineForRow(r) === productLineFilter);
  }, [rows, productLineFilter]);

  const productLineCounts = useMemo(() => {
    const m = new Map<FactoryProductLine, number>();
    for (const pl of FACTORY_PRODUCT_LINES) m.set(pl.id, 0);
    let unknown = 0;
    for (const r of rows) {
      const line = inferProductLineForRow(r);
      if (line === 'unknown') unknown += 1;
      else m.set(line, (m.get(line) ?? 0) + 1);
    }
    return { lines: m, unknown };
  }, [rows]);

  const boardColumns = useMemo(
    () =>
      FACTORY_COLUMNS.map((col) => ({
        ...col,
        items: sortIterationsByEditDateDesc(
          rowsForView.filter((r) => columnForStage(inferFactoryStage(r)) === col.id),
        ),
      })),
    [rowsForView],
  );

  const newestShippedIds = useMemo(
    () =>
      newestShippedIterationIdsByPipeline(
        rowsForView,
        (r) => inferFactoryStage(r) === 'shipped',
      ),
    [rowsForView],
  );

  const downloadUnitTestCsv = async (link: PipelineIterationUnitTestLink) => {
    setUtDownloadBusy(link.s3Key);
    try {
      const { url } = await fetchUnitTestRunDownloadUrl(link.s3Key);
      const a = document.createElement('a');
      a.href = url;
      a.download = link.fileName || link.s3Key.split('/').pop() || 'unit-test.csv';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Unit test file download failed');
    } finally {
      setUtDownloadBusy(null);
    }
  };

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
                Four stages at a glance: labelling → training → ready → deployed. Same registry as{' '}
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

        <div className="model-factory-toolbar">
          <div className="model-factory-toolbar-actions">
          <button type="button" className="view-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button type="button" className="view-button" onClick={() => navigate('/training')}>
            <Layers size={16} />
            Model Training Center
          </button>
          <button
            type="button"
            className="view-button"
            onClick={() => {
              const next = mergeP3TrainingIterationIfMissing(
                applyMay2026SpreadsheetToRegistry(rowsRef.current),
              );
              setRows(next);
              rowsRef.current = next;
              setSaveError(null);
            }}
            disabled={loading}
            title="Six completed eval rows + p3 #3 in training (1700 images) if missing"
          >
            Import May 2026 metrics
          </button>
          <button type="button" className="view-button" onClick={openAdd}>
            <Plus size={16} />
            New iteration
          </button>
          </div>
          <div className="model-factory-product-filters" role="group" aria-label="Product line">
            <button
              type="button"
              className={`model-factory-product-filter${productLineFilter === 'all' ? ' model-factory-product-filter--active' : ''}`}
              onClick={() => setProductLineFilter('all')}
            >
              All
              <span className="model-factory-product-filter-count">{rows.length}</span>
            </button>
            {FACTORY_PRODUCT_LINES.map((pl) => (
              <button
                key={pl.id}
                type="button"
                className={`model-factory-product-filter model-factory-product-filter--${pl.id}${productLineFilter === pl.id ? ' model-factory-product-filter--active' : ''}`}
                onClick={() => setProductLineFilter(pl.id)}
                title={pl.label}
              >
                {pl.short}
                <span className="model-factory-product-filter-count">
                  {productLineCounts.lines.get(pl.id) ?? 0}
                </span>
              </button>
            ))}
          </div>
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
          <div className="model-factory-board" role="region" aria-label="Pipeline board">
            {boardColumns.map((col) => (
              <section
                key={col.id}
                className={`model-factory-board-column model-factory-board-column--${col.id}`}
                aria-label={col.label}
              >
                <header className="model-factory-board-column-head">
                  <h2 className="model-factory-board-column-title">{col.label}</h2>
                  <span className="model-factory-board-column-count">{col.items.length}</span>
                  <p className="model-factory-board-column-hint">{col.hint}</p>
                </header>
                <ul className="model-factory-list-rows model-factory-board-column-body">
                  {col.items.map((r) => (
                    <ModelFactoryIterationRow
                      key={r.id}
                      row={r}
                      showNewPill={inferFactoryStage(r) === 'shipped' && newestShippedIds.has(r.id)}
                      saving={saving}
                      utDownloadBusy={utDownloadBusy}
                      onEdit={openEdit}
                      onAdvance={(row) => void advanceStage(row)}
                      onDelete={(row) => void deleteIteration(row)}
                      onDownloadUt={(link) => void downloadUnitTestCsv(link)}
                    />
                  ))}
                </ul>
                {!col.items.length ? (
                  <p className="model-factory-board-empty">No iterations in {col.label.toLowerCase()}.</p>
                ) : null}
              </section>
            ))}
            {!rowsForView.length ? (
              <p className="pipeline-iterations-empty model-factory-board-empty-all">
                {rows.length
                  ? `No iterations for ${productLineFilter.toUpperCase()}.`
                  : 'No iterations yet — create one to start the line.'}
              </p>
            ) : null}
          </div>
        )}

      </main>

      <PipelineIterationFormModal
        open={modalOpen}
        initial={modalDraft}
        existingIterations={rows}
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
