import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ClipboardList, Download, Loader2 } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import {
  fetchPipelineIterations,
  fetchUnitTestRunDownloadUrl,
  fetchUnitTestRuns,
  type UnitTestRunIndexRow,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { PORTAL_DISPLAY_TIME_ZONE, calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';
import {
  FACTORY_PRODUCT_LINES,
  type FactoryProductLine,
} from '../constants/factoryStages';
import {
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from '../utils/dateRangePresets';
import {
  enrichUnitTestRuns,
  pipelineBadgeLabel,
  runTimestampIso,
  type EnrichedUnitTestRun,
} from '../utils/unitTestRunEnrichment';

type ProductLineFilter = 'all' | Exclude<FactoryProductLine, 'unknown'>;
type DatePresetFilter = 'all' | DateRangePresetId;
type SortOrder = 'desc' | 'asc';

function formatRunTimestamp(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PORTAL_DISPLAY_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function matchesDatePreset(run: EnrichedUnitTestRun, preset: DatePresetFilter): boolean {
  if (preset === 'all') return true;
  if (!isDateRangePresetId(preset)) return true;
  const ts = run.runTimestamp;
  if (!ts) return false;
  const day = calendarDayKeyInPortalTz(ts);
  if (!day) return false;
  const { from, to } = getDateRangeFromPreset(preset);
  return day >= from && day <= to;
}

function PipelineBadge({ line, label }: { line: FactoryProductLine; label: string }) {
  if (line === 'unknown') {
    return <span className="unit-test-results-pipeline-plain">{label}</span>;
  }
  return (
    <span
      className={`unit-test-results-pipeline-badge unit-test-results-pipeline-badge--${line}`}
      title={label}
    >
      {label}
    </span>
  );
}

const UnitTestResultsPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<UnitTestRunIndexRow[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const [productLineFilter, setProductLineFilter] = useState<ProductLineFilter>('all');
  const [iterationFilter, setIterationFilter] = useState<number | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DatePresetFilter>('all');
  const [runByFilter, setRunByFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const workMode = outletCtx?.workMode;
  const allowed = workMode === 'admin' || workMode === 'labeler';

  const loadRuns = useCallback(async () => {
    setErr(null);
    try {
      const [runsRes, iterationsRes] = await Promise.all([
        fetchUnitTestRuns(workType, { includeSummary: true }),
        fetchPipelineIterations(),
      ]);
      setRuns(runsRes.runs);
      void iterationsRes;
      return iterationsRes.iterations ?? [];
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load unit test runs');
      return [];
    }
  }, [workType]);

  const [iterations, setIterations] = useState<Awaited<ReturnType<typeof loadRuns>>>([]);

  useEffect(() => {
    if (!allowed) {
      navigate('/', { replace: true });
    }
  }, [allowed, navigate]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    void (async () => {
      const iters = await loadRuns();
      setIterations(iters);
      setLoading(false);
    })();
  }, [allowed, loadRuns]);

  const enrichedRuns = useMemo(
    () => enrichUnitTestRuns(runs, iterations),
    [runs, iterations],
  );

  const runByOptions = useMemo(() => {
    const names = new Set<string>();
    for (const run of enrichedRuns) {
      const who = run.runBy?.trim();
      if (who) names.add(who);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [enrichedRuns]);

  const iterationOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const run of enrichedRuns) {
      if (run.iterationNumber != null) nums.add(run.iterationNumber);
    }
    return [...nums].sort((a, b) => a - b);
  }, [enrichedRuns]);

  const productLineCounts = useMemo(() => {
    const counts = new Map<ProductLineFilter, number>();
    counts.set('all', enrichedRuns.length);
    for (const pl of FACTORY_PRODUCT_LINES) {
      if (pl.id === 'p1' || pl.id === 'p2' || pl.id === 'p3') counts.set(pl.id, 0);
    }
    for (const run of enrichedRuns) {
      if (run.productLine === 'p1' || run.productLine === 'p2' || run.productLine === 'p3') {
        counts.set(run.productLine, (counts.get(run.productLine) ?? 0) + 1);
      }
    }
    return counts;
  }, [enrichedRuns]);

  const filteredRuns = useMemo(() => {
    let list = enrichedRuns.filter((run) => {
      if (productLineFilter !== 'all' && run.productLine !== productLineFilter) return false;
      if (iterationFilter !== 'all' && run.iterationNumber !== iterationFilter) return false;
      if (!matchesDatePreset(run, datePreset)) return false;
      if (runByFilter !== 'all') {
        const who = run.runBy?.trim() || '';
        if (who !== runByFilter) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      const ta = Date.parse(runTimestampIso(a) ?? '') || 0;
      const tb = Date.parse(runTimestampIso(b) ?? '') || 0;
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });
    return list;
  }, [enrichedRuns, productLineFilter, iterationFilter, datePreset, runByFilter, sortOrder]);

  const activeFilterCount = [
    productLineFilter !== 'all',
    iterationFilter !== 'all',
    datePreset !== 'all',
    runByFilter !== 'all',
  ].filter(Boolean).length;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const iters = await loadRuns();
      setIterations(iters);
    } finally {
      setRefreshing(false);
    }
  }, [loadRuns]);

  const clearFilters = () => {
    setProductLineFilter('all');
    setIterationFilter('all');
    setDatePreset('all');
    setRunByFilter('all');
  };

  const handleDownload = async (run: EnrichedUnitTestRun) => {
    setDownloadingKey(run.key);
    try {
      const { url } = await fetchUnitTestRunDownloadUrl(run.key);
      const a = document.createElement('a');
      a.href = url;
      a.download = run.fileName || run.key.split('/').pop() || 'unit-test.csv';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloadingKey(null);
    }
  };

  if (!allowed) return null;

  return (
    <div className="readings-list-page unit-test-results-page">
      <header className="page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={20} />
              <span>Back to Dashboard</span>
            </button>
            <div className="page-title">
              <ClipboardList size={32} strokeWidth={1.5} />
              <div>
                <h1>Unit test results</h1>
                <p>
                  iOS batch exports · work type {workType}
                  {enrichedRuns.length
                    ? ` · ${filteredRuns.length} of ${enrichedRuns.length} run${enrichedRuns.length === 1 ? '' : 's'}`
                    : ''}
                </p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton onRefresh={handleRefresh} busy={refreshing} />
        </div>
      </header>

      {err ? (
        <div className="login-error" style={{ margin: '1rem 1.5rem' }}>
          <span>{err}</span>
        </div>
      ) : null}

      {!loading && enrichedRuns.length > 0 ? (
        <div className="unit-test-results-toolbar">
          <div className="model-factory-product-filters" role="group" aria-label="Pipeline product line">
            <button
              type="button"
              className={`model-factory-product-filter${productLineFilter === 'all' ? ' model-factory-product-filter--active' : ''}`}
              onClick={() => setProductLineFilter('all')}
            >
              All pipelines
              <span className="model-factory-product-filter-count">{enrichedRuns.length}</span>
            </button>
            {FACTORY_PRODUCT_LINES.map((pl) => (
              <button
                key={pl.id}
                type="button"
                className={`model-factory-product-filter model-factory-product-filter--${pl.id}${productLineFilter === pl.id ? ' model-factory-product-filter--active' : ''}`}
                onClick={() => setProductLineFilter(pl.id as ProductLineFilter)}
                title={pl.label}
              >
                {pl.short}
                <span className="model-factory-product-filter-count">
                  {(pl.id === 'p1' || pl.id === 'p2' || pl.id === 'p3')
                    ? (productLineCounts.get(pl.id) ?? 0)
                    : 0}
                </span>
              </button>
            ))}
          </div>

          <div className="unit-test-results-filter-row">
            <label className="unit-test-results-filter">
              <span className="unit-test-results-filter-label">Iteration</span>
              <select
                value={iterationFilter === 'all' ? 'all' : String(iterationFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setIterationFilter(v === 'all' ? 'all' : parseInt(v, 10));
                }}
              >
                <option value="all">All</option>
                {iterationOptions.map((n) => (
                  <option key={n} value={n}>
                    #{n}
                  </option>
                ))}
              </select>
            </label>

            <label className="unit-test-results-filter">
              <span className="unit-test-results-filter-label">Date</span>
              <select value={datePreset} onChange={(e) => setDatePreset(e.target.value as DatePresetFilter)}>
                <option value="all">All dates</option>
                {(['today', 'yesterday', 'last7', 'last30'] as const).map((p) => (
                  <option key={p} value={p}>
                    {formatPresetLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            <label className="unit-test-results-filter">
              <span className="unit-test-results-filter-label">Run by</span>
              <select value={runByFilter} onChange={(e) => setRunByFilter(e.target.value)}>
                <option value="all">Anyone</option>
                {runByOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="unit-test-results-filter">
              <span className="unit-test-results-filter-label">Sort</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                aria-label="Sort by run date"
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>

            <button
              type="button"
              className="unit-test-results-sort-toggle"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              title={sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              aria-label={sortOrder === 'desc' ? 'Switch to oldest first' : 'Switch to newest first'}
            >
              {sortOrder === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
            </button>

            {activeFilterCount > 0 ? (
              <button type="button" className="login-link-btn" onClick={clearFilters}>
                Clear filters ({activeFilterCount})
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? (
        <ListViewLoading message="Loading unit test runs…" />
      ) : enrichedRuns.length === 0 ? (
        <p className="pipeline-iterations-empty" style={{ padding: '2rem 1.5rem' }}>
          No unit test CSV exports found under <code>{workType}/unit_test_results/</code>.
        </p>
      ) : filteredRuns.length === 0 ? (
        <p className="pipeline-iterations-empty" style={{ padding: '2rem 1.5rem' }}>
          No runs match the current filters.
        </p>
      ) : (
        <div className="unit-test-results-table-wrap">
          <table className="pipeline-iterations-table pipeline-iterations-table--compact unit-test-results-table">
            <thead>
              <tr>
                <th>Run time</th>
                <th>Run by</th>
                <th>Pipeline</th>
                <th>Iteration</th>
                <th>Images</th>
                <th>App version</th>
                <th>Accuracy</th>
                <th>Confidence</th>
                <th aria-label="Download" />
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.key}>
                  <td>{formatRunTimestamp(run.runTimestamp)}</td>
                  <td>{run.runBy?.trim() || '—'}</td>
                  <td className="unit-test-results-td-pipeline">
                    <PipelineBadge line={run.productLine} label={pipelineBadgeLabel(run)} />
                    {run.pipelineVersion ? (
                      <span className="unit-test-results-pipeline-version" title="Model version from CSV">
                        v{run.pipelineVersion}
                      </span>
                    ) : null}
                  </td>
                  <td>{run.iterationNumber != null ? `#${run.iterationNumber}` : '—'}</td>
                  <td>{run.imagesProcessed != null ? run.imagesProcessed : '—'}</td>
                  <td>{run.appVersion?.trim() || '—'}</td>
                  <td>{formatPct(run.accuracyPercent)}</td>
                  <td>{formatPct(run.averageConfidencePct)}</td>
                  <td>
                    <button
                      type="button"
                      className="pipeline-iterations-icon-btn"
                      title="Download CSV"
                      aria-label={`Download ${run.fileName}`}
                      onClick={() => void handleDownload(run)}
                      disabled={downloadingKey === run.key}
                    >
                      {downloadingKey === run.key ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UnitTestResultsPage;
