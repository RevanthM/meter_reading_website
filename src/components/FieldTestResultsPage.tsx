import { useCallback, useEffect, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ClipboardList, Download } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import FieldTestCycleDashboard from './FieldTestCycleDashboard';
import {
  createFieldTestCycle,
  deleteFieldTestCycle,
  downloadFieldTestCycleCsv,
  FIELD_TEST_ANALYTICS_MIN_VERSION,
  fetchFieldTestCycleAnalytics,
  fetchFieldTestCycles,
  updateFieldTestCycle,
  type FieldTestCycle,
  type FieldTestCycleStatus,
  type FieldTestRollup,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canViewFieldTestResults } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';

const FieldTestResultsPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cycles, setCycles] = useState<FieldTestCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [rollup, setRollup] = useState<FieldTestRollup | null>(null);
  const [analyticsSource, setAnalyticsSource] = useState<string | null>(null);
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [editingCycle, setEditingCycle] = useState(false);
  const [formName, setFormName] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formStatus, setFormStatus] = useState<FieldTestCycleStatus>('active');
  const [formNotes, setFormNotes] = useState('');
  const [savingCycle, setSavingCycle] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  useEffect(() => {
    if (!outletCtx?.workMode || !canViewFieldTestResults(outletCtx.workMode)) {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  const loadCycles = useCallback(async () => {
    const res = await fetchFieldTestCycles(workType);
    setCycles(res.cycles);
    const pick = res.activeCycle?.id || res.cycles[0]?.id || '';
    setSelectedCycleId((prev) => (prev && res.cycles.some((c) => c.id === prev) ? prev : pick));
    return pick;
  }, [workType]);

  const loadAnalytics = useCallback(
    async (cycleId: string, refresh = false) => {
      if (!cycleId) {
        setRollup(null);
        return;
      }
      setAnalyticsLoading(true);
      setErr(null);
      try {
        let res = await fetchFieldTestCycleAnalytics(workType, cycleId, { refresh });
        const needsRebuild =
          !refresh &&
          (res.rollup?.version ?? 0) < FIELD_TEST_ANALYTICS_MIN_VERSION;
        if (needsRebuild) {
          res = await fetchFieldTestCycleAnalytics(workType, cycleId, { refresh: true });
        }
        setRollup(res.rollup);
        setAnalyticsSource(res.source ?? null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load analytics');
        setRollup(null);
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [workType],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const id = await loadCycles();
        if (!cancelled && id) await loadAnalytics(id);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load cycles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCycles, loadAnalytics]);

  const handleRefreshAll = async () => {
    const id = await loadCycles();
    if (id) await loadAnalytics(id, true);
  };

  const resetCycleForm = () => {
    setFormName('');
    setFormStart('');
    setFormEnd('');
    setFormStatus('active');
    setFormNotes('');
  };

  const openEditCycle = () => {
    const c = cycles.find((x) => x.id === selectedCycleId);
    if (!c) return;
    setFormName(c.name);
    setFormStart(c.startDate);
    setFormEnd(c.endDate);
    setFormStatus(c.status);
    setFormNotes(c.notes || '');
    setEditingCycle(true);
    setShowNewCycle(false);
  };

  const handleCreateCycle = async () => {
    if (!formName.trim() || !formStart || !formEnd) return;
    setSavingCycle(true);
    try {
      const res = await createFieldTestCycle({
        workType,
        name: formName.trim(),
        startDate: formStart,
        endDate: formEnd,
        status: formStatus,
        notes: formNotes.trim() || undefined,
      });
      setCycles(res.cycles);
      setSelectedCycleId(res.cycle.id);
      setShowNewCycle(false);
      resetCycleForm();
      await loadAnalytics(res.cycle.id, true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Create cycle failed');
    } finally {
      setSavingCycle(false);
    }
  };

  const handleDeleteCycle = async () => {
    if (!selectedCycleId || !selectedCycle) return;
    const ok = window.confirm(
      `Delete cycle "${selectedCycle.name}" (${selectedCycle.startDate} – ${selectedCycle.endDate})? This cannot be undone.`,
    );
    if (!ok) return;
    setSavingCycle(true);
    try {
      const res = await deleteFieldTestCycle(workType, selectedCycleId);
      setCycles(res.cycles);
      setEditingCycle(false);
      setShowNewCycle(false);
      resetCycleForm();
      const nextId = res.cycles[0]?.id || '';
      setSelectedCycleId(nextId);
      setRollup(null);
      if (nextId) await loadAnalytics(nextId, true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete cycle failed');
    } finally {
      setSavingCycle(false);
    }
  };

  const handleUpdateCycle = async () => {
    if (!selectedCycleId || !formName.trim() || !formStart || !formEnd) return;
    setSavingCycle(true);
    try {
      const res = await updateFieldTestCycle(workType, selectedCycleId, {
        name: formName.trim(),
        startDate: formStart,
        endDate: formEnd,
        status: formStatus,
        notes: formNotes.trim(),
      });
      setCycles(res.cycles);
      setEditingCycle(false);
      resetCycleForm();
      await loadAnalytics(selectedCycleId, true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Update cycle failed');
    } finally {
      setSavingCycle(false);
    }
  };

  const selectedCycle = cycles.find((c) => c.id === selectedCycleId) ?? null;

  const handleDownloadCsv = async () => {
    if (!selectedCycleId) return;
    setDownloadingCsv(true);
    try {
      await downloadFieldTestCycleCsv(workType, selectedCycleId);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'CSV export failed');
    } finally {
      setDownloadingCsv(false);
    }
  };

  return (
    <div className="readings-list-page unit-test-results-page field-test-results-page">
      <header className="page-header unit-test-results-page-header field-test-results-page-header">
        <div className="field-test-results-header-inner">
          <div className="header-content list-page-header-with-actions">
            <div className="list-page-header-lead">
              <div className="page-title">
                <ClipboardList size={32} strokeWidth={1.5} />
                <div>
                  <h1>Field test results</h1>
                  <p>Cycle analytics from field-mode iOS captures (reads, not images).</p>
                </div>
              </div>
            </div>
            <ListPageRefreshButton
              variant="icon"
              onRefresh={() => void handleRefreshAll()}
              busy={loading || analyticsLoading}
              disabled={loading}
              title="Reload cycles and rebuild analytics"
            />
          </div>

          <div className="field-test-results-toolbar">
            <label className="field-test-results-cycle-field">
              <span className="unit-test-images-filter-label">Cycle</span>
              <select
                className="unit-test-images-filter-select field-test-results-cycle-select"
                value={selectedCycleId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCycleId(id);
                  void loadAnalytics(id);
                }}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.startDate} – {c.endDate}){c.status === 'active' ? ' · active' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-test-results-actions" role="group" aria-label="Cycle actions">
              <button
                type="button"
                className="training-hub-text-btn"
                disabled={!selectedCycleId}
                onClick={openEditCycle}
              >
                Edit cycle
              </button>
              <button
                type="button"
                className="training-hub-text-btn"
                onClick={() => {
                  setShowNewCycle((v) => !v);
                  setEditingCycle(false);
                  if (!showNewCycle) resetCycleForm();
                }}
              >
                {showNewCycle ? 'Cancel' : 'New cycle'}
              </button>
              <button
                type="button"
                className="unit-test-run-download-btn field-test-results-download-btn"
                disabled={!selectedCycleId || downloadingCsv || !rollup}
                onClick={() => void handleDownloadCsv()}
                title="Download cycle CSV (location, tilt, per-dial angles)"
              >
                <Download size={16} aria-hidden />
                <span>{downloadingCsv ? 'Exporting…' : 'Download CSV'}</span>
              </button>
              <button
                type="button"
                className="training-hub-text-btn field-test-delete-cycle-btn"
                disabled={!selectedCycleId || savingCycle}
                onClick={() => void handleDeleteCycle()}
              >
                Delete cycle
              </button>
            </div>
          </div>

          {showNewCycle || editingCycle ? (
            <div className="field-test-new-cycle-form">
            <h3 className="field-test-cycle-form-title">{editingCycle ? 'Edit cycle' : 'New cycle'}</h3>
            <label>
              Name
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="May field pilot"
              />
            </label>
            <label>
              Start
              <input type="date" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
            </label>
            <label>
              End
              <input type="date" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
            </label>
            <label>
              Status
              <select
                className="unit-test-images-filter-select"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as FieldTestCycleStatus)}
              >
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="draft">Draft</option>
              </select>
            </label>
            <label>
              Notes
              <input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <button
              type="button"
              className="save-button"
              disabled={savingCycle}
              onClick={() => void (editingCycle ? handleUpdateCycle() : handleCreateCycle())}
            >
              {savingCycle ? 'Saving…' : editingCycle ? 'Save changes' : 'Create cycle'}
            </button>
            </div>
          ) : null}
        </div>
      </header>

      {loading ? <ListViewLoading message="Loading field test cycles…" /> : null}
      {err ? <p className="training-hub-inline-error">{err}</p> : null}

      {analyticsLoading && rollup ? (
        <ListViewLoading variant="inline" message="Refreshing cycle analytics…" />
      ) : null}

      {!loading && rollup ? (
        <>
          {selectedCycle ? (
            <p className="field-test-results-cycle-meta">
              {selectedCycle.startDate} – {selectedCycle.endDate} · built{' '}
              {new Date(rollup.builtAt).toLocaleString()}
              {rollup.version != null ? ` · rollup v${rollup.version}` : ''}
              {analyticsSource ? ` · ${analyticsSource}` : ''}
              {rollup.excludedFromResultsCount != null && rollup.excludedFromResultsCount > 0
                ? ` · ${rollup.excludedFromResultsCount} excluded (not correct/incorrect)`
                : ''}
              {rollup.cycleCaptureCount != null && rollup.cycleCaptureCount > rollup.captureCount
                ? ` · ${rollup.captureCount} scored of ${rollup.cycleCaptureCount} in range`
                : null}
              {analyticsLoading ? ' · updating…' : null}
            </p>
          ) : null}
          <FieldTestCycleDashboard rollup={rollup} />
        </>
      ) : null}

      {!loading && !err && cycles.length === 0 ? (
        <p className="pipeline-iterations-empty">Create a cycle with a date range to analyze field captures.</p>
      ) : null}
    </div>
  );
};

export default FieldTestResultsPage;
