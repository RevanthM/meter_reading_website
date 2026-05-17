import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Layers, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import {
  fetchPipelineIterations,
  savePipelineIterations,
  type PipelineIterationRecord,
} from '../services/api';
import PipelineIterationFormModal from './PipelineIterationFormModal';
import PipelineIterationsCharts from './PipelineIterationsCharts';

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
    currentStatus: '',
    subStatus: '',
    outcome: '',
    portalStats: null,
    manualMetrics: {},
    linkedUnitTests: [],
  };
}

function cloneRow(r: PipelineIterationRecord): PipelineIterationRecord {
  return JSON.parse(JSON.stringify(r)) as PipelineIterationRecord;
}

function escCsv(s: string): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function ncsv(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(v);
}

function iterationsToCsv(rows: PipelineIterationRecord[]): string {
  const headers = [
    'Pipeline',
    'Iteration #',
    'Model #',
    'App Version',
    'Start Date',
    'Planned End Date',
    'Scope',
    '# of Images',
    'Images Added Since Last Iteration',
    'Current Status',
    'Sub Status',
    'Outcome',
    'Portal_PulledAt',
    'Portal_TotalSessions',
    'Portal_TotalImages',
    'Portal_SimulatorSessions',
    'Portal_SimulatorImages',
    'Portal_FieldSessions',
    'Portal_FieldImages',
    'Portal_AvgSessionConfidence_0_1',
    'Portal_QueueCorrect_All_pct',
    'Portal_QueueCorrect_Sim_pct',
    'Portal_QueueCorrect_Field_pct',
    'Portal_DigitMatch_UT_pct',
    'Portal_Dial1_UT_pct',
    'Portal_Dial2_UT_pct',
    'Portal_Dial3_UT_pct',
    'Portal_Dial4_UT_pct',
    'Portal_DigitMatch_FT_pct',
    'Portal_Dial1_FT_pct',
    'Portal_Dial2_FT_pct',
    'Portal_Dial3_FT_pct',
    'Portal_Dial4_FT_pct',
    'Manual_Roboflow_AvgBbox_pct',
    'Manual_Roboflow_AvgKeypoint_pct',
    'Manual_App_AvgBbox_pct',
    'Manual_App_AvgKeypoint_pct',
    'Manual_ReadAcc_SimulatorLaptop_pct',
    'Manual_ReadAcc_UT_pct',
    'Manual_ReadAcc_FT_pct',
    'Manual_Dial1_UT_pct',
    'Manual_Dial2_UT_pct',
    'Manual_Dial3_UT_pct',
    'Manual_Dial4_UT_pct',
    'Manual_ReadAcc_FT_Row_pct',
    'Manual_Dial1_FT_pct',
    'Manual_Dial2_FT_pct',
    'Manual_Dial3_FT_pct',
    'Manual_Dial4_FT_pct',
    'Manual_UT_Images_Laptop',
    'Manual_UT_Images_GalleryOrScreen',
    'Manual_FieldTest_Images',
    'Manual_ExactReadingAccuracy_pct',
    'Manual_ManualReviewRate_pct',
    'Manual_SimDial1_Accuracy_pct',
    'Manual_SimDial2_Accuracy_pct',
    'Manual_SimDial3_Accuracy_pct',
    'Manual_SimDial4_Accuracy_pct',
    'Manual_AppDial1_Accuracy_pct',
    'Manual_AppDial2_Accuracy_pct',
    'Manual_AppDial3_Accuracy_pct',
    'Manual_AppDial4_Accuracy_pct',
    'Manual_SimDial1_Confidence_pct',
    'Manual_SimDial2_Confidence_pct',
    'Manual_SimDial3_Confidence_pct',
    'Manual_SimDial4_Confidence_pct',
    'Manual_AppDial1_Confidence_pct',
    'Manual_AppDial2_Confidence_pct',
    'Manual_AppDial3_Confidence_pct',
    'Manual_AppDial4_Confidence_pct',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const ps = r.portalStats;
    const m = r.manualMetrics ?? {};
    lines.push(
      [
        escCsv(r.pipeline),
        String(r.iterationNumber),
        escCsv(r.modelId),
        escCsv(r.appVersion),
        escCsv(r.startDate),
        escCsv(r.plannedEndDate),
        escCsv(r.scope),
        ncsv(r.imageCount),
        ncsv(r.imagesAddedSinceLastIteration),
        escCsv(r.currentStatus),
        escCsv(r.subStatus ?? ''),
        escCsv(r.outcome),
        ps ? escCsv(ps.pulledAt) : '',
        ps ? String(ps.totalSessions) : '',
        ps ? String(ps.totalImages) : '',
        ps ? String(ps.simulatorSessions) : '',
        ps ? String(ps.simulatorImages) : '',
        ps ? String(ps.fieldSessions) : '',
        ps ? String(ps.fieldImages) : '',
        ps && ps.avgSessionConfidence != null ? String(ps.avgSessionConfidence) : '',
        ncsv(ps?.queueCorrectRateAll ?? undefined),
        ncsv(ps?.queueCorrectRateSimulator ?? undefined),
        ncsv(ps?.queueCorrectRateField ?? undefined),
        ncsv(ps?.digitMatchUtPct ?? undefined),
        ncsv(ps?.dial1UtPct ?? undefined),
        ncsv(ps?.dial2UtPct ?? undefined),
        ncsv(ps?.dial3UtPct ?? undefined),
        ncsv(ps?.dial4UtPct ?? undefined),
        ncsv(ps?.digitMatchFtPct ?? undefined),
        ncsv(ps?.dial1FtPct ?? undefined),
        ncsv(ps?.dial2FtPct ?? undefined),
        ncsv(ps?.dial3FtPct ?? undefined),
        ncsv(ps?.dial4FtPct ?? undefined),
        ncsv(m.roboflowAvgBboxConfidence ?? undefined),
        ncsv(m.roboflowAvgKeypointConfidence ?? undefined),
        ncsv(m.appAvgBboxConfidence ?? undefined),
        ncsv(m.appAvgKeypointConfidence ?? undefined),
        ncsv(m.readAccuracySimulatorLaptop ?? undefined),
        ncsv(m.readAccuracyUt ?? undefined),
        ncsv(m.readAccuracyFt ?? undefined),
        ncsv(m.dial1UtPct ?? undefined),
        ncsv(m.dial2UtPct ?? undefined),
        ncsv(m.dial3UtPct ?? undefined),
        ncsv(m.dial4UtPct ?? undefined),
        ncsv(m.readAccuracyFtRow ?? undefined),
        ncsv(m.dial1FtPct ?? undefined),
        ncsv(m.dial2FtPct ?? undefined),
        ncsv(m.dial3FtPct ?? undefined),
        ncsv(m.dial4FtPct ?? undefined),
        ncsv(m.unitTestImagesLaptop ?? undefined),
        ncsv(m.unitTestImagesGalleryOrScreen ?? undefined),
        ncsv(m.fieldTestImageCount ?? undefined),
        ncsv(m.exactReadingAccuracyPct ?? undefined),
        ncsv(m.manualReviewRatePct ?? undefined),
        ncsv(m.simDial1AccuracyPct ?? undefined),
        ncsv(m.simDial2AccuracyPct ?? undefined),
        ncsv(m.simDial3AccuracyPct ?? undefined),
        ncsv(m.simDial4AccuracyPct ?? undefined),
        ncsv(m.appDial1AccuracyPct ?? undefined),
        ncsv(m.appDial2AccuracyPct ?? undefined),
        ncsv(m.appDial3AccuracyPct ?? undefined),
        ncsv(m.appDial4AccuracyPct ?? undefined),
        ncsv(m.simDial1ConfidencePct ?? undefined),
        ncsv(m.simDial2ConfidencePct ?? undefined),
        ncsv(m.simDial3ConfidencePct ?? undefined),
        ncsv(m.simDial4ConfidencePct ?? undefined),
        ncsv(m.appDial1ConfidencePct ?? undefined),
        ncsv(m.appDial2ConfidencePct ?? undefined),
        ncsv(m.appDial3ConfidencePct ?? undefined),
        ncsv(m.appDial4ConfidencePct ?? undefined),
      ].join(','),
    );
  }
  return lines.join('\n');
}

const PipelineIterationsPage: FC = () => {
  const navigate = useNavigate();
  const { userEmail } = useAuth();
  const { filteredReadings, workType, dataSource } = useReadings();

  const [rows, setRows] = useState<PipelineIterationRecord[]>([]);
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({
    updatedAt: null,
    updatedBy: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<PipelineIterationRecord>(() => newEmptyRow());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const doc = await fetchPipelineIterations();
      setRows(doc.iterations.length ? doc.iterations : []);
      setMeta({ updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pipelineNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const p = r.pipeline.trim();
      if (p) s.add(p);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!pipelineFilter.trim()) return rows;
    const q = pipelineFilter.trim().toLowerCase();
    return rows.filter((r) => r.pipeline.trim().toLowerCase() === q);
  }, [rows, pipelineFilter]);

  const byPipeline = useMemo(() => {
    const m = new Map<string, PipelineIterationRecord[]>();
    for (const r of rows) {
      const key = r.pipeline.trim() || '(unnamed)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    for (const [, list] of m) {
      list.sort((a, b) => a.iterationNumber - b.iterationNumber);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

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

  const handleSaveS3 = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const doc = await savePipelineIterations(userEmail || undefined, rows);
      setRows(doc.iterations);
      setMeta({ updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([iterationsToCsv(filteredRows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-iterations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="readings-list-page pipeline-iterations-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Home</span>
          </button>
          <div className="page-title">
            <Layers size={32} strokeWidth={1.5} />
            <div>
              <h1>Pipeline iterations</h1>
              <p>
                Registry in S3: portal metrics by app version, manual Roboflow / eval fields, and optional sub-status.
                Charts reflect the current filter when a pipeline is selected. Save changes with <strong>Save to S3</strong>.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="list-content">
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

        <div className="pipeline-iterations-toolbar">
          <label className="pipeline-iterations-filter">
            <span>Filter by pipeline</span>
            <select
              value={pipelineFilter}
              onChange={(e) => setPipelineFilter(e.target.value)}
              className="pipeline-iterations-select"
            >
              <option value="">All pipelines</option>
              {pipelineNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="pipeline-iterations-toolbar-actions">
            <button type="button" className="view-button" onClick={exportCsv} disabled={!filteredRows.length}>
              <Download size={16} />
              Export CSV (filtered)
            </button>
            <button type="button" className="view-button" onClick={openAdd} disabled={loading}>
              <Plus size={16} aria-hidden />
              Add iteration…
            </button>
            <button
              type="button"
              className="save-button pipeline-iterations-save-s3"
              onClick={() => void handleSaveS3()}
              disabled={saving || loading}
            >
              {saving ? <Loader2 size={18} className="spin" aria-hidden /> : <Save size={18} aria-hidden />}
              Save to S3
            </button>
          </div>
        </div>

        {meta.updatedAt ? (
          <p className="pipeline-iterations-meta">
            Last saved {new Date(meta.updatedAt).toLocaleString()}
            {meta.updatedBy ? ` · ${meta.updatedBy}` : ''}
          </p>
        ) : null}

        {loading ? (
          <div className="loading-state">
            <Loader2 size={40} className="spin" aria-hidden />
            <p>Loading registry…</p>
          </div>
        ) : (
          <>
            <PipelineIterationsCharts
              rows={filteredRows}
              onIterationClick={(id) => {
                const r = filteredRows.find((x) => x.id === id);
                if (r) openEdit(r);
              }}
            />

            <div className="table-container pipeline-iterations-table-wrap">
              <table className="readings-table pipeline-iterations-table pipeline-iterations-table--compact">
                <thead>
                  <tr>
                    <th>Pipeline</th>
                    <th>Iter</th>
                    <th>Model</th>
                    <th>App</th>
                    <th>Start</th>
                    <th title="Manual override or, if empty, same as portal snapshot image total when loaded.">
                      # Img
                    </th>
                    <th
                      scope="col"
                      title="Snapshot from portal readings for this row’s app version: how many sessions and images match the current work type and data source (set in the header). Filled when you use “Load from portal” in the iteration editor."
                    >
                      Portal
                    </th>
                    <th>Status</th>
                    <th>Sub</th>
                    <th title="Linked iOS unit-test CSV exports on S3">UT CSV</th>
                    <th>Outcome</th>
                    <th>List</th>
                    <th>Edit</th>
                    <th aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const ps = r.portalStats;
                    return (
                      <tr key={r.id}>
                        <td>{r.pipeline || '—'}</td>
                        <td>{r.iterationNumber}</td>
                        <td>{r.modelId || '—'}</td>
                        <td>{r.appVersion || '—'}</td>
                        <td>{r.startDate || '—'}</td>
                        <td>{r.imageCount != null ? r.imageCount : ps?.totalImages ?? '—'}</td>
                        <td>
                          {ps ? (
                            <span className="pipeline-iterations-portal-pill" title={ps.pulledAt}>
                              {ps.totalSessions} sess · {ps.totalImages} img
                            </span>
                          ) : (
                            <span className="readings-confidence-missing">—</span>
                          )}
                        </td>
                        <td>{r.currentStatus || '—'}</td>
                        <td>{r.subStatus?.trim() ? r.subStatus : '—'}</td>
                        <td>
                          {(r.linkedUnitTests?.length ?? 0) > 0 ? (
                            <span
                              className="pipeline-iterations-portal-pill"
                              title={(r.linkedUnitTests ?? []).map((l) => l.fileName || l.s3Key).join('\n')}
                            >
                              {r.linkedUnitTests!.length} linked
                            </span>
                          ) : (
                            <span className="readings-confidence-missing">—</span>
                          )}
                        </td>
                        <td className="pipeline-iterations-td-scope">{r.outcome || '—'}</td>
                        <td>
                          {r.appVersion.trim() ? (
                            <button
                              type="button"
                              className="training-hub-text-btn"
                              onClick={() =>
                                navigate(`/readings/all?appVersion=${encodeURIComponent(r.appVersion.trim())}`)
                              }
                            >
                              Open
                            </button>
                          ) : (
                            <span className="readings-confidence-missing">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pipeline-iterations-icon-btn"
                            title="Edit"
                            aria-label="Edit"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil size={16} />
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pipeline-iterations-icon-btn"
                            title="Remove row"
                            aria-label="Remove row"
                            onClick={() => removeRow(r.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredRows.length ? (
                <p className="pipeline-iterations-empty">
                  {rows.length ? 'No rows match this filter.' : 'No iterations yet. Use Add iteration…'}
                </p>
              ) : null}
            </div>

            <section className="pipeline-iterations-compare" aria-labelledby="pipeline-compare-heading">
              <h2 id="pipeline-compare-heading">Compare by pipeline</h2>
              <p className="pipeline-iterations-compare-hint">
                Rows grouped by pipeline name. Open a row to see Roboflow / eval fields and full portal metrics.
              </p>
              <div className="pipeline-iterations-compare-grid">
                {byPipeline.map(([name, list]) => (
                  <div key={name} className="pipeline-iterations-compare-card">
                    <h3>{name}</h3>
                    <ul>
                      {list.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="pipeline-iterations-compare-edit" onClick={() => openEdit(r)}>
                            <strong>#{r.iterationNumber}</strong> {r.modelId ? `· ${r.modelId}` : ''}{' '}
                            {r.appVersion ? `· ${r.appVersion}` : ''}
                          </button>
                          <br />
                          <span className="pipeline-iterations-compare-sub">
                            {r.startDate || '—'} · {r.portalStats ? `${r.portalStats.totalImages} img` : 'no portal snap'}{' '}
                            · {r.currentStatus || '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {!byPipeline.length ? <p className="pipeline-iterations-empty">Nothing to compare yet.</p> : null}
            </section>
          </>
        )}
      </main>

      <PipelineIterationFormModal
        open={modalOpen}
        initial={modalDraft}
        onClose={() => setModalOpen(false)}
        onSave={commitModalRow}
        readings={filteredReadings}
        workType={workType}
        dataSource={dataSource}
      />
    </div>
  );
};

export default PipelineIterationsPage;
