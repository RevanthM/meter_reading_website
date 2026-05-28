import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { ImageIcon, Search, X } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import {
  fetchFieldTestCaptures,
  fetchFieldTestCycles,
  type FieldTestCaptureRow,
  type FieldTestCycle,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canViewFieldTest } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import {
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  type FieldTestCaptureFilters,
  fieldTestFiltersActive,
} from '../utils/fieldTestImageFilters';

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

const FieldTestImagesPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cycles, setCycles] = useState<FieldTestCycle[]>([]);
  const [activeCycle, setActiveCycle] = useState<FieldTestCycle | null>(null);
  const [captures, setCaptures] = useState<FieldTestCaptureRow[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FieldTestCaptureFilters>({
    query: '',
    difficulty: 'all',
    user: 'all',
    corrected: 'all',
  });

  const cycleId = searchParams.get('cycleId') || activeCycle?.id || '';

  useEffect(() => {
    if (!outletCtx?.workMode || !canViewFieldTest(outletCtx.workMode)) {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const cyclesRes = await fetchFieldTestCycles(workType);
      setCycles(cyclesRes.cycles);
      const selected =
        cyclesRes.cycles.find((c) => c.id === cycleId) || cyclesRes.activeCycle || cyclesRes.cycles[0] || null;
      setActiveCycle(selected);
      const capRes = await fetchFieldTestCaptures(workType, {
        cycleId: selected?.id,
        page: 1,
        limit: 96,
        q: filters.query,
        difficulty: filters.difficulty,
        user: filters.user,
        corrected: filters.corrected,
        presign: true,
      });
      setCaptures(capRes.captures);
      setUsers(capRes.filterOptions.users);
      setTotal(capRes.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load field test captures');
    } finally {
      setLoading(false);
    }
  }, [workType, cycleId, filters.query, filters.difficulty, filters.user, filters.corrected]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const onCycleChange = (id: string) => {
    setSearchParams(id ? { cycleId: id } : {});
  };

  const filtersActive = fieldTestFiltersActive(filters);
  const clearFilters = () => setFilters({ query: '', difficulty: 'all', user: 'all', corrected: 'all' });

  const countLabel = useMemo(() => {
    if (loading) return null;
    return `${total.toLocaleString()} capture${total === 1 ? '' : 's'}${activeCycle ? ` · ${activeCycle.name}` : ''}`;
  }, [loading, total, activeCycle]);

  return (
    <div className="readings-list-page unit-test-images-page field-test-images-page">
      <header className="page-header unit-test-images-page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <div className="page-title">
              <ImageIcon size={32} strokeWidth={1.5} />
              <div>
                <h1>Field test images</h1>
                {countLabel ? <p aria-live="polite">{countLabel}</p> : null}
              </div>
            </div>
          </div>
          <ListPageRefreshButton
            variant="icon"
            onRefresh={() => void handleRefresh()}
            busy={refreshing || loading}
            disabled={loading}
            title="Refresh field test captures"
          />
        </div>

        {!loading && !err ? (
          <div className="unit-test-images-filter-toolbar field-test-images-filter-toolbar">
            <label className="unit-test-images-filter-select-wrap">
              <span className="unit-test-images-filter-label">Cycle</span>
              <select
                className="unit-test-images-filter-select"
                value={cycleId}
                onChange={(e) => onCycleChange(e.target.value)}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.startDate} – {c.endDate})
                  </option>
                ))}
              </select>
            </label>
            <label className="unit-test-images-search-field">
              <Search size={18} className="unit-test-images-search-icon" aria-hidden />
              <input
                type="search"
                placeholder="Search by reading or session…"
                value={filters.query}
                onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
                aria-label="Search field test captures"
              />
              {filters.query ? (
                <button
                  type="button"
                  className="unit-test-images-search-clear"
                  onClick={() => setFilters((p) => ({ ...p, query: '' }))}
                  aria-label="Clear search"
                >
                  <X size={16} aria-hidden />
                </button>
              ) : null}
            </label>
            <label className="unit-test-images-filter-select-wrap">
              <span className="unit-test-images-filter-label">Difficulty</span>
              <select
                className="unit-test-images-filter-select"
                value={filters.difficulty}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    difficulty: e.target.value as FieldTestCaptureFilters['difficulty'],
                  }))
                }
              >
                {UNIT_TEST_DIFFICULTY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="unit-test-images-filter-select-wrap">
              <span className="unit-test-images-filter-label">Taken by</span>
              <select
                className="unit-test-images-filter-select"
                value={filters.user}
                onChange={(e) => setFilters((p) => ({ ...p, user: e.target.value }))}
              >
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="unit-test-images-filter-select-wrap">
              <span className="unit-test-images-filter-label">Corrected</span>
              <select
                className="unit-test-images-filter-select"
                value={filters.corrected}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    corrected: e.target.value as FieldTestCaptureFilters['corrected'],
                  }))
                }
              >
                <option value="all">All</option>
                <option value="yes">User corrected</option>
                <option value="no">No correction</option>
              </select>
            </label>
            {filtersActive ? (
              <button type="button" className="unit-test-images-filter-clear" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {loading && captures.length === 0 ? <ListViewLoading message="Loading field test captures…" /> : null}
      {err ? <p className="unit-test-images-page-message training-hub-inline-error">{err}</p> : null}

      {!loading && !err && captures.length === 0 ? (
        <p className="unit-test-images-page-message pipeline-iterations-empty">
          No field captures in this cycle match your filters. New iOS field uploads with dial review appear here after
          Dynamo sync.
        </p>
      ) : null}

      {captures.length > 0 ? (
        <div className="unit-test-images-grid unit-test-images-page-grid">
          {captures.map((cap) => (
            <article key={cap.sessionId} className="unit-test-images-card">
              {cap.url ? (
                <img src={cap.url} alt="" className="unit-test-images-thumb" loading="lazy" />
              ) : (
                <div className="unit-test-images-thumb unit-test-images-thumb--empty">No preview</div>
              )}
              <div className="unit-test-images-card-head">
                <span className={difficultyBadgeClass(cap.imageDifficulty)}>
                  {formatUnitTestDifficultyTag(cap.imageDifficulty)}
                </span>
                {cap.hadUserCorrection ? (
                  <span className="field-test-corrected-pill">Corrected</span>
                ) : null}
              </div>
              <p className="unit-test-images-name">
                <code>{cap.finalReading || '—'}</code>
              </p>
              <p className="unit-test-images-expected">
                Predicted: <strong>{cap.predictedReading ?? '—'}</strong>
              </p>
              <p className="unit-test-images-meta-line">
                {cap.capturedBy || 'Unknown'} · {cap.dialCount} reads
              </p>
            </article>
          ))}
        </div>
      ) : null}

      {total > captures.length ? (
        <p className="field-test-images-more-hint">
          Showing first {captures.length} of {total}. Narrow filters or increase limit in a future page.
        </p>
      ) : null}
    </div>
  );
};

export default FieldTestImagesPage;
