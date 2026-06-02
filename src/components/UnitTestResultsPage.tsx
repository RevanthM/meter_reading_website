import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Calendar,
  ClipboardList,
  Download,
  Filter,
  Loader2,
  Smartphone,
  User,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import {
  fetchPipelineIterations,
  fetchUnitTestRunDownloadUrl,
  fetchUnitTestRuns,
  type PipelineIterationRecord,
  type UnitTestRunIndexRow,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { PORTAL_DISPLAY_TIME_ZONE, calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';
import { formatUnitTestRunCardHeadline } from '../utils/unitTestDisplayLabels';
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
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

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
  return formatPortalAccuracyConfidencePct(value);
}

function accuracyStatClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'unit-test-run-stat-value--muted';
  if (value >= 90) return 'unit-test-run-stat-value--good';
  if (value >= 75) return 'unit-test-run-stat-value--mid';
  return 'unit-test-run-stat-value--low';
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

function averageMetric(
  runs: EnrichedUnitTestRun[],
  pick: (r: EnrichedUnitTestRun) => number | null | undefined,
): number | null {
  const vals = runs.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const UnitTestResultsPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<UnitTestRunIndexRow[]>([]);
  const [iterations, setIterations] = useState<PipelineIterationRecord[]>([]);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const [productLineFilter, setProductLineFilter] = useState<ProductLineFilter>('all');
  const [iterationFilter, setIterationFilter] = useState<number | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DatePresetFilter>('all');
  const [runByFilter, setRunByFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const workMode = outletCtx?.workMode;
  const allowed = workMode === 'admin' || workMode === 'labeler';

  /** S3 key list only — one list call, no per-CSV summary reads. */
  const loadRunKeys = useCallback(async () => {
    setErr(null);
    const runsRes = await fetchUnitTestRuns(workType);
    setRuns(runsRes.runs);
  }, [workType]);

  /** Up to ~50 CSV summary heads from S3 + pipeline registry for iteration links. */
  const loadRunMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const [summaryRes, iterationsRes] = await Promise.all([
        fetchUnitTestRuns(workType, { includeSummary: true }),
        fetchPipelineIterations(),
      ]);
      setRuns(summaryRes.runs);
      setIterations(iterationsRes.iterations ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load run metrics');
    } finally {
      setMetricsLoading(false);
    }
  }, [workType]);

  useEffect(() => {
    if (!allowed) {
      navigate('/', { replace: true });
    }
  }, [allowed, navigate]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await loadRunKeys();
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Failed to load unit test runs');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      await loadRunMetrics();
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, loadRunKeys, loadRunMetrics]);

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

  const filteredSummary = useMemo(() => {
    const avgAccuracy = averageMetric(filteredRuns, (r) => r.accuracyPercent);
    const avgConfidence = averageMetric(filteredRuns, (r) => r.averageConfidencePct);
    const totalImages = filteredRuns.reduce(
      (sum, r) => sum + (r.imagesProcessed != null && Number.isFinite(r.imagesProcessed) ? r.imagesProcessed : 0),
      0,
    );
    return { avgAccuracy, avgConfidence, totalImages };
  }, [filteredRuns]);

  const activeFilterCount = [
    productLineFilter !== 'all',
    iterationFilter !== 'all',
    datePreset !== 'all',
    runByFilter !== 'all',
  ].filter(Boolean).length;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      await loadRunKeys();
      await loadRunMetrics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to refresh unit test runs');
    } finally {
      setRefreshing(false);
    }
  }, [loadRunKeys, loadRunMetrics]);

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
      <header className="page-header unit-test-results-page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={20} />
              <span>Back</span>
            </button>
            <div className="page-title">
              <ClipboardList size={32} strokeWidth={1.5} />
              <div>
                <h1>Unit test results</h1>
                <p>
                  Unit test results · work type {workType}
                  {!loading && enrichedRuns.length > 0
                    ? ` · ${filteredRuns.length} of ${enrichedRuns.length} run${enrichedRuns.length === 1 ? '' : 's'}`
                    : ''}
                  {metricsLoading ? ' · loading metrics…' : ''}
                </p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton onRefresh={handleRefresh} busy={refreshing} />
        </div>
      </header>

      {err ? (
        <div className="unit-test-results-alert" role="alert">
          <span>{err}</span>
        </div>
      ) : null}

      {!loading && enrichedRuns.length > 0 ? (
        <>
          <section className="unit-test-results-summary" aria-label="Filtered run summary">
            <div className="unit-test-results-summary-card">
              <span className="unit-test-results-summary-label">Runs shown</span>
              <span className="unit-test-results-summary-value">{filteredRuns.length.toLocaleString()}</span>
            </div>
            <div className="unit-test-results-summary-card">
              <span className="unit-test-results-summary-label">Avg accuracy</span>
              <span
                className={`unit-test-results-summary-value ${metricsLoading ? 'unit-test-run-stat-value--muted' : accuracyStatClass(filteredSummary.avgAccuracy)}`}
              >
                {metricsLoading ? '…' : formatPct(filteredSummary.avgAccuracy)}
              </span>
            </div>
            <div className="unit-test-results-summary-card">
              <span className="unit-test-results-summary-label">Avg confidence</span>
              <span
                className={`unit-test-results-summary-value${metricsLoading ? ' unit-test-run-stat-value--muted' : ''}`}
              >
                {metricsLoading ? '…' : formatPct(filteredSummary.avgConfidence)}
              </span>
            </div>
            <div className="unit-test-results-summary-card">
              <span className="unit-test-results-summary-label">Images tested</span>
              <span
                className={`unit-test-results-summary-value${metricsLoading ? ' unit-test-run-stat-value--muted' : ''}`}
              >
                {metricsLoading
                  ? '…'
                  : filteredSummary.totalImages > 0
                    ? filteredSummary.totalImages.toLocaleString()
                    : '—'}
              </span>
            </div>
          </section>

          <section className="unit-test-results-filters-panel" aria-label="Filter unit test runs">
            <div className="unit-test-results-filters-head">
              <Filter size={16} aria-hidden />
              <span>Filters</span>
              {activeFilterCount > 0 ? (
                <button type="button" className="unit-test-results-clear-filters" onClick={clearFilters}>
                  Clear ({activeFilterCount})
                </button>
              ) : null}
            </div>

            <div className="model-factory-product-filters unit-test-results-pipeline-filters" role="group" aria-label="Pipeline product line">
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
            </div>
          </section>
        </>
      ) : null}

      {loading ? (
        <ListViewLoading message="Loading unit test results…" />
      ) : enrichedRuns.length === 0 ? (
        <div className="unit-test-results-empty">
          <BarChart3 size={40} strokeWidth={1.25} aria-hidden />
          <p>
            No results yet.
          </p>
          <p className="unit-test-results-empty-hint">Results appear here after a unit test completes.</p>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="unit-test-results-empty">
          <Filter size={40} strokeWidth={1.25} aria-hidden />
          <p>No results match the current filters.</p>
          <button type="button" className="unit-test-results-clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="unit-test-runs-list">
          {filteredRuns.map((run) => {
            const busy = downloadingKey === run.key;
            const headline = formatUnitTestRunCardHeadline({
              runTimestamp: run.runTimestamp,
              generatedUtc: run.generatedUtc,
              accuracyPercent: run.accuracyPercent,
              imagesProcessed: run.imagesProcessed,
              pipelineDisplayName: run.pipelineDisplayName,
              pipelineId: run.pipelineId,
            });
            return (
              <li key={run.key}>
                <article className="unit-test-run-card">
                  <header className="unit-test-run-card-header">
                    <div className="unit-test-run-card-when">
                      <Calendar size={16} aria-hidden />
                      <time dateTime={run.runTimestamp ?? undefined}>{formatRunTimestamp(run.runTimestamp)}</time>
                    </div>
                    <button
                      type="button"
                      className="unit-test-run-download-btn"
                      title="Download unit test file"
                      aria-label="Download unit test file"
                      onClick={() => void handleDownload(run)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 size={18} className="spin" aria-hidden />
                      ) : (
                        <Download size={18} aria-hidden />
                      )}
                      <span>{busy ? 'Preparing…' : 'Download unit test file'}</span>
                    </button>
                  </header>

                  <p className="unit-test-run-card-filename">{headline}</p>

                  <div className="unit-test-run-card-meta">
                    <span className="unit-test-run-meta-chip">
                      <User size={14} aria-hidden />
                      {run.runBy?.trim() || 'Unknown'}
                    </span>
                    <span className="unit-test-run-meta-chip unit-test-run-meta-chip--pipeline">
                      <PipelineBadge line={run.productLine} label={pipelineBadgeLabel(run)} />
                      {run.pipelineVersion ? (
                        <span className="unit-test-results-pipeline-version" title="Model version">
                          v{run.pipelineVersion}
                        </span>
                      ) : null}
                    </span>
                    {run.iterationNumber != null ? (
                      <span className="unit-test-run-meta-chip">Iter #{run.iterationNumber}</span>
                    ) : null}
                    {run.appVersion?.trim() ? (
                      <span className="unit-test-run-meta-chip">
                        <Smartphone size={14} aria-hidden />
                        App {run.appVersion.trim()}
                      </span>
                    ) : null}
                  </div>

                  <dl className="unit-test-run-card-stats">
                    <div>
                      <dt>Images</dt>
                      <dd>{run.imagesProcessed != null ? run.imagesProcessed.toLocaleString() : '—'}</dd>
                    </div>
                    <div>
                      <dt>Accuracy</dt>
                      <dd className={accuracyStatClass(run.accuracyPercent)}>
                        {formatPct(run.accuracyPercent)}
                      </dd>
                    </div>
                    <div>
                      <dt>Confidence</dt>
                      <dd>{formatPct(run.averageConfidencePct)}</dd>
                    </div>
                  </dl>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default UnitTestResultsPage;
