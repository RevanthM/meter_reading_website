import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useReadings, type DataSource } from '../context/ReadingsContext';
import {
  Gauge,
  RefreshCw,
  Cloud,
  HardDrive,
  Loader2,
  Radio,
  Monitor,
  Layers,
  ChevronDown,
  Briefcase,
  Download,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import type { DashboardCounts, ReadingStatus, WorkType } from '../types';
import { statusColors, statusLabels, workTypeLabels } from '../types';
import {
  downloadIncorrectRetrainZip,
  fetchImprovementStats,
  fetchPipelineIterations,
  type ImprovementChartRange,
  type ModelVersionStats,
  type PipelineIterationRecord,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { DashboardRoleHome } from './DashboardRoleHome';
import { isAppVersionExcludedFromDashboardViz, type ImprovementStoryBin } from '../utils/dashboardImprovementStats';
import {
  calendarDayKeyInPortalTz,
  formatPortalWeekdayMedium,
  portalDayKeysRollingWindow,
} from '../utils/readingDisplayDates';
import DashboardImprovementChart from './DashboardImprovementChart';

/** Summary strip display (override computed latest-session values). */
const DASHBOARD_STRIP_CURRENT_CONFIDENCE_PCT = 68.8;
const DASHBOARD_STRIP_CURRENT_ACCURACY_PCT = 91;

const IMPROVEMENT_CHART_DEFER_MS = 80;
const IMPROVEMENT_CHART_POLL_MS = 2500;

/** Run low-priority admin chart work after counts paint (avoids blocking other API calls). */
function scheduleDeferredDashboardTask(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => fn(), { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(fn, IMPROVEMENT_CHART_DEFER_MS);
  return () => window.clearTimeout(t);
}

const STATUS_DONUT_ORDER: ReadingStatus[] = [
  'correct',
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
  'no_dials',
  'not_sure',
];

function donutSlicePath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number,
): string {
  const sr = (startDeg * Math.PI) / 180;
  const er = (endDeg * Math.PI) / 180;
  const x1 = cx + rOuter * Math.cos(sr);
  const y1 = cy + rOuter * Math.sin(sr);
  const x2 = cx + rOuter * Math.cos(er);
  const y2 = cy + rOuter * Math.sin(er);
  const x3 = cx + rInner * Math.cos(er);
  const y3 = cy + rInner * Math.sin(er);
  const x4 = cx + rInner * Math.cos(sr);
  const y4 = cy + rInner * Math.sin(sr);
  const sweep = endDeg - startDeg;
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
}

type DonutSeg = { status: ReadingStatus; value: number; color: string; label: string };

function buildDonutSegments(counts: DashboardCounts): DonutSeg[] {
  const v = (s: ReadingStatus): number => {
    switch (s) {
      case 'correct':
        return counts.correctCount;
      case 'incorrect_new':
        return counts.incorrectNewCount;
      case 'incorrect_analyzed':
        return counts.incorrectAnalyzedCount;
      case 'incorrect_labeled':
        return counts.incorrectLabeledCount;
      case 'incorrect_training':
        return counts.incorrectTrainingCount;
      case 'no_dials':
        return counts.noDialsCount;
      case 'not_sure':
        return counts.notSureCount;
      default:
        return 0;
    }
  };
  return STATUS_DONUT_ORDER.map((status) => ({
    status,
    value: v(status),
    color: statusColors[status],
    label: statusLabels[status],
  })).filter((s) => s.value > 0);
}

const StatusDonutChart: FC<{
  counts: DashboardCounts;
  onSegment: (status: ReadingStatus) => void;
  /** Omit card heading when the page section already provides the title (dashboard solo donut). */
  soloLayout?: boolean;
}> = ({ counts, onSegment, soloLayout }) => {
  const segments = useMemo(() => buildDonutSegments(counts), [counts]);
  const total = counts.totalPictures;
  const cx = 100;
  const cy = 100;
  const rOuter = 78;
  const rInner = 48;

  const paths = useMemo(() => {
    if (total <= 0 || segments.length === 0) return [];
    let angle = -90;
    return segments.map((seg) => {
      const sweep = (seg.value / total) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      const d = donutSlicePath(cx, cy, rInner, rOuter, start, end);
      return { ...seg, d, key: seg.status };
    });
  }, [segments, total]);

  return (
    <div className={`chart-card chart-card--donut${soloLayout ? ' chart-card--donut-solo' : ''}`}>
      {!soloLayout ? (
        <div className="chart-header chart-header--stack">
          <div className="chart-header-titles">
            <div className="chart-header-row">
              <Gauge size={18} />
              <h3>Sessions by status</h3>
            </div>
            <p className="chart-explainer">
              Share of sessions in this view. Click a slice or a row in the legend to open that list.
            </p>
          </div>
        </div>
      ) : null}
      <div className="dashboard-donut-body">
        <div className="dashboard-donut-chart">
          {total <= 0 || paths.length === 0 ? (
            <div className="chart-empty chart-empty--donut">No sessions for this filter</div>
          ) : (
            <svg viewBox="0 0 200 200" className="dashboard-donut-svg" role="img" aria-label="Status distribution">
              {paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  fill={p.color}
                  className="dashboard-donut-slice"
                  stroke="var(--bg-secondary)"
                  strokeWidth="1"
                  onClick={() => onSegment(p.status)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSegment(p.status);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.label}: ${p.value}, open list`}
                />
              ))}
              <text x={cx} y={cy - 6} textAnchor="middle" className="dashboard-donut-center-n">
                {total.toLocaleString()}
              </text>
              <text x={cx} y={cy + 14} textAnchor="middle" className="dashboard-donut-center-l">
                sessions
              </text>
            </svg>
          )}
        </div>
        <ul className="dashboard-donut-legend">
          {total <= 0 ? (
            <li className="dashboard-donut-legend-empty">No sessions for this filter</li>
          ) : (
            STATUS_DONUT_ORDER.map((status) => {
              const n =
                status === 'correct'
                  ? counts.correctCount
                  : status === 'incorrect_new'
                    ? counts.incorrectNewCount
                    : status === 'incorrect_analyzed'
                      ? counts.incorrectAnalyzedCount
                      : status === 'incorrect_labeled'
                        ? counts.incorrectLabeledCount
                        : status === 'incorrect_training'
                          ? counts.incorrectTrainingCount
                          : status === 'no_dials'
                            ? counts.noDialsCount
                            : counts.notSureCount;
              const pct = ((n / total) * 100).toFixed(1);
              return (
                <li key={status}>
                  <button type="button" className="dashboard-donut-legend-row" onClick={() => onSegment(status)}>
                    <span className="dashboard-donut-legend-dot" style={{ background: statusColors[status] }} />
                    <span className="dashboard-donut-legend-label">{statusLabels[status]}</span>
                    <span className="dashboard-donut-legend-val">
                      {n.toLocaleString()} <span className="dashboard-donut-legend-pct">({pct}%)</span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
};

type KpiMiniProps = {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  variant?: 'default' | 'accent' | 'danger' | 'warning';
  disabled?: boolean;
  loading?: boolean;
};

const KpiMiniCard: FC<KpiMiniProps> = ({
  label,
  value,
  hint,
  onClick,
  variant = 'default',
  disabled,
  loading = false,
}) => (
  <button
    type="button"
    className={[
      'dashboard-kpi-item',
      variant !== 'default' ? `dashboard-kpi-item--${variant}` : '',
      loading ? 'dashboard-kpi-item--loading' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onClick}
    disabled={disabled || loading}
  >
    <span className="dashboard-kpi-label">{label}</span>
    <span className="dashboard-kpi-value">{loading ? '—' : value}</span>
    {hint ? <span className="dashboard-kpi-hint">{hint}</span> : null}
  </button>
);

function kpiCount(n: number, loading: boolean): string {
  return loading ? '—' : n.toLocaleString();
}

const ModelVersionAccuracyBars: FC<{
  versions: ModelVersionStats[];
  loading: boolean;
  onOpenModels: () => void;
  /** Open all-readings list filtered to this metadata app_version (respects chart time window). */
  onBrowseVersion?: (appVersion: string) => void;
}> = ({ versions, loading, onOpenModels, onBrowseVersion }) => {
  const rows = useMemo(
    () =>
      versions
        .filter((v) => v.appVersion !== 'unknown' && !isAppVersionExcludedFromDashboardViz(v.appVersion))
        .slice(0, 10),
    [versions],
  );

  return (
    <div className="chart-card chart-card--hero chart-card--model-bars">
      <div className="chart-header chart-header--stack chart-header--model">
        <div className="chart-header-titles">
          <div className="chart-header-row">
            <Cpu size={18} />
            <h3>Per app version</h3>
          </div>
          <p className="chart-explainer">
            Cached analytics index by <strong>app_version</strong> (correct-queue share and avg confidence). Use Refresh on
            the toolbar to rebuild the index from S3 when needed.
          </p>
        </div>
        <button type="button" className="dashboard-card-link dashboard-card-link--header" onClick={onOpenModels}>
          Models <ExternalLink size={14} aria-hidden />
        </button>
      </div>
      {loading ? (
        <div className="chart-empty chart-empty--tight">
          <Loader2 size={28} className="spin" />
          <span>Loading version mix…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="chart-empty chart-empty--tight">
          No version breakdown yet (no <code>app_version</code> on sessions, or use live data).
        </div>
      ) : (
        <div className="model-vs-accuracy-bars">
          {rows.map((v) => {
            const pct = Math.min(100, Math.round(v.queueCorrectRate * 1000) / 10);
            const label = v.appVersion === 'unknown' ? 'Unknown version' : v.appVersion;
            return (
              <div key={v.appVersion} className="model-vs-accuracy-row">
                <div className="model-vs-accuracy-label" title={v.appVersion}>
                  <div className="model-vs-accuracy-label-row">
                    <span className="model-vs-accuracy-name">{label}</span>
                    {onBrowseVersion ? (
                      <button
                        type="button"
                        className="model-vs-accuracy-list-btn"
                        onClick={() => onBrowseVersion(v.appVersion)}
                        title="Open readings list for this app version"
                      >
                        List
                      </button>
                    ) : null}
                  </div>
                  <span className="model-vs-accuracy-meta">
                    {v.sessions.toLocaleString()} sessions
                    {v.imageCount != null ? ` · ${v.imageCount.toLocaleString()} images` : ''}
                    {v.avgConfidence != null && Number.isFinite(v.avgConfidence)
                      ? ` · avg conf ${Math.round(v.avgConfidence * 100)}%`
                      : ''}
                  </span>
                </div>
                <div className="model-vs-accuracy-track" role="presentation">
                  <div
                    className="model-vs-accuracy-fill"
                    style={{ width: `${pct}%` }}
                    title={`${pct}% in correct queue`}
                  />
                </div>
                <span className="model-vs-accuracy-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Time window for dashboard volume + labeled-share charts (drill-down by day still works). */
type ChartRangeId = ImprovementChartRange;

const CHART_RANGE_IDS: ChartRangeId[] = ['all', '1d', '7d', '14d', '30d'];

const CHART_RANGE_DAY_COUNT: Record<Exclude<ChartRangeId, 'all'>, number> = {
  '1d': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

const CHART_RANGE_LABELS: Record<ChartRangeId, string> = {
  all: 'All time',
  '1d': 'Today',
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
};

/** Query string so the readings list matches the chart chip window (`from`/`to` on upload day, inclusive). */
function getChartRangeSearchSuffix(rangeId: ChartRangeId): string {
  if (rangeId === 'all') return '';
  const n = CHART_RANGE_DAY_COUNT[rangeId];
  const days = portalDayKeysRollingWindow(n);
  const from = days[0];
  const to = days[days.length - 1];
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

const Dashboard: FC = () => {
  const {
    counts,
    countsLoading,
    error,
    isUsingRealData,
    refreshCounts,
    dataSource,
    setDataSource,
    workType,
    setWorkType,
  } = useReadings();
  const [zipExporting, setZipExporting] = useState(false);
  const [chartRange, setChartRange] = useState<ChartRangeId>('all');
  const [modelVersions, setModelVersions] = useState<ModelVersionStats[]>([]);
  const [registryIterations, setRegistryIterations] = useState<PipelineIterationRecord[]>([]);
  const [improvementBins, setImprovementBins] = useState<ImprovementStoryBin[]>([]);
  const [improvementLoading, setImprovementLoading] = useState(false);
  const [improvementWindowCount, setImprovementWindowCount] = useState(0);
  const [improvementStorageUri, setImprovementStorageUri] = useState<string | null>(null);

  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalRole = outletCtx?.workMode ?? 'reviewer';
  const isAdminDashboard = portalRole === 'admin';

  const applyImprovementResponse = useCallback((res: Awaited<ReturnType<typeof fetchImprovementStats>>) => {
    setImprovementBins(res.bins ?? []);
    setImprovementWindowCount(res.windowSessionCount ?? 0);
    setModelVersions(res.versionSummary ?? []);
    setImprovementStorageUri(res.storage?.uri ?? null);
    return Boolean(res.building || res.rebuilding);
  }, []);

  const loadImprovementChart = useCallback(
    async (refresh = false): Promise<boolean> => {
      setImprovementLoading(true);
      try {
        const res = await fetchImprovementStats(dataSource, workType, chartRange, refresh);
        const pending = applyImprovementResponse(res);
        setImprovementLoading(pending);
        return pending;
      } catch {
        setImprovementBins([]);
        setImprovementWindowCount(0);
        setModelVersions([]);
        setImprovementStorageUri(null);
        setImprovementLoading(false);
        return false;
      }
    },
    [applyImprovementResponse, chartRange, dataSource, workType],
  );

  useEffect(() => {
    if (!isAdminDashboard) {
      setImprovementLoading(false);
      setImprovementBins([]);
      setModelVersions([]);
      return;
    }
    if (countsLoading) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (refresh: boolean) => {
      if (cancelled) return;
      const pending = await loadImprovementChart(refresh);
      if (cancelled || !pending) return;
      pollTimer = window.setTimeout(() => void load(false), IMPROVEMENT_CHART_POLL_MS);
    };

    const cancelDefer = scheduleDeferredDashboardTask(() => {
      void load(false);
    });

    return () => {
      cancelled = true;
      cancelDefer();
      if (pollTimer != null) window.clearTimeout(pollTimer);
    };
  }, [countsLoading, dataSource, isAdminDashboard, loadImprovementChart, workType, chartRange]);

  const glanceCounts = counts;
  const kpiDataLoading = countsLoading;

  const registryStoryHint = useMemo(() => {
    const rows = registryIterations.filter(
      (r) =>
        r.manualMetrics?.exactReadingAccuracyPct != null &&
        Number.isFinite(r.manualMetrics.exactReadingAccuracyPct),
    );
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => {
      const ta = new Date(a.startDate || 0).getTime();
      const tb = new Date(b.startDate || 0).getTime();
      return tb - ta;
    });
    const top = sorted[0];
    const pct = top.manualMetrics!.exactReadingAccuracyPct!;
    const pipe = top.pipeline.trim() || '—';
    return `Latest pipeline registry: ${pipe} · ${pct.toFixed(1)}% exact reading · app ${top.appVersion || '—'}.`;
  }, [registryIterations]);

  useEffect(() => {
    if (!isAdminDashboard) {
      setRegistryIterations([]);
      return;
    }
    if (countsLoading) return;

    let cancelled = false;
    const cancelDefer = scheduleDeferredDashboardTask(() => {
      void fetchPipelineIterations()
        .then((doc) => {
          if (!cancelled) setRegistryIterations(doc.iterations ?? []);
        })
        .catch(() => {
          if (!cancelled) setRegistryIterations([]);
        });
    });

    return () => {
      cancelled = true;
      cancelDefer();
    };
  }, [countsLoading, isAdminDashboard]);

  const todayDrillIso = calendarDayKeyInPortalTz(new Date().toISOString());
  const todayHintDisplay = formatPortalWeekdayMedium(new Date().toISOString());

  const incorrectQueuesTotal = useMemo(
    () =>
      glanceCounts.incorrectNewCount +
      glanceCounts.incorrectAnalyzedCount +
      glanceCounts.incorrectLabeledCount +
      glanceCounts.incorrectTrainingCount,
    [glanceCounts],
  );

  const handleCardClick = (status: ReadingStatus | 'all') => {
    navigate(`/readings/${status}${getChartRangeSearchSuffix(chartRange)}`);
  };

  const handleViewAllSessions = () => {
    navigate(`/readings/all${getChartRangeSearchSuffix(chartRange)}`);
  };

  const handleDrillByDay = (isoDay: string) => {
    navigate(`/readings/all?date=${encodeURIComponent(isoDay)}`);
  };

  const handleDrillImprovementByAppVersion = (appVersion: string) => {
    const suffix = getChartRangeSearchSuffix(chartRange);
    const conn = suffix ? `${suffix}&` : '?';
    navigate(`/readings/all${conn}appVersion=${encodeURIComponent(appVersion)}`);
  };

  const labeledSharePct =
    glanceCounts.totalPictures > 0
      ? Math.round((glanceCounts.correctCount / glanceCounts.totalPictures) * 1000) / 10
      : 0;

  const refreshDashboardLight = useCallback(async () => {
    await refreshCounts();
    if (!isAdminDashboard) return;
    void loadImprovementChart(true);
  }, [isAdminDashboard, loadImprovementChart, refreshCounts]);

  const dashboardSubtitle = isAdminDashboard
    ? 'Analytics, registry & full queue overview'
    : portalRole === 'reviewer'
      ? 'Review queue & outcomes'
      : portalRole === 'test_data_reviewer'
        ? 'Test data approval'
        : 'Model Training Center & pipeline folders';

  const handleDownloadIncorrectZip = async () => {
    if (!isUsingRealData) {
      window.alert('Connect to live S3 data first (start the API server), then try again.');
      return;
    }
    setZipExporting(true);
    try {
      await downloadIncorrectRetrainZip(dataSource, workType);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setZipExporting(false);
    }
  };

  const totalReadingsInRange = glanceCounts.totalPictures;

  const sourceOptions: { value: DataSource; label: string; icon: ReactNode }[] = [
    { value: 'all', label: 'All Sources', icon: <Layers size={14} /> },
    { value: 'field', label: 'Field', icon: <Radio size={14} /> },
    { value: 'simulator', label: 'Simulator', icon: <Monitor size={14} /> },
  ];

  const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];


  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-inner">
          <div className="dashboard-toolbar-main">
            <div className="logo">
              <Gauge size={36} strokeWidth={1.5} />
              <div>
                <h1>Meter Reading</h1>
                <p>{dashboardSubtitle}</p>
              </div>
            </div>
            <div className="header-actions">
              {isAdminDashboard ? (
              <div className="source-toggle" role="group" aria-label="Data source">
                {sourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`source-btn ${dataSource === option.value ? 'active' : ''}`}
                    onClick={() => setDataSource(option.value)}
                    title={option.label}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              ) : null}
              <div className={`data-source data-source--pill ${isUsingRealData ? 'real' : 'mock'}`}>
                {isUsingRealData ? <Cloud size={15} /> : <HardDrive size={15} />}
                <span>{isUsingRealData ? 'S3' : 'Mock'}</span>
              </div>
              {isAdminDashboard ? (
              <button
                type="button"
                className="export-incorrect-btn"
                onClick={handleDownloadIncorrectZip}
                disabled={zipExporting || !isUsingRealData}
                title="Flat ZIP of incorrect-queue sessions (raw photos + dataset.json at root; Roboflow-friendly)"
              >
                {zipExporting ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
                <span>{zipExporting ? 'ZIP…' : 'Export ZIP'}</span>
              </button>
              ) : null}
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refreshDashboardLight()}
                title={
                  isAdminDashboard
                    ? 'Refresh counts and cached charts (does not reload all sessions)'
                    : 'Refresh folder counts'
                }
                aria-busy={countsLoading || (isAdminDashboard && improvementLoading)}
              >
                <RefreshCw
                  size={17}
                  className={countsLoading || (isAdminDashboard && improvementLoading) ? 'spin' : ''}
                />
              </button>
            </div>
          </div>
          <div className="dashboard-toolbar-sub">
            <div className="work-type-toolbar">
              <Briefcase size={15} className="work-type-toolbar-icon" aria-hidden />
              <span className="work-type-toolbar-label">Work type</span>
              <div className="work-type-dropdown">
                <select
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value as WorkType)}
                  className="work-type-select"
                  aria-label="Work type"
                >
                  {workTypeOptions.map((wt) => (
                    <option key={wt} value={wt}>
                      {wt} — {workTypeLabels[wt]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="dropdown-icon" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <span className="hint">Start the API server with: npm run server</span>
        </div>
      )}

      {!isAdminDashboard ? (
        <DashboardRoleHome
          role={portalRole}
          counts={glanceCounts}
          countsLoading={kpiDataLoading}
          incorrectQueuesTotal={incorrectQueuesTotal}
        />
      ) : (
      <main className="dashboard-content dashboard-content--visual">
        <section className="dashboard-section dashboard-section--viz dashboard-section--improvement">
            <div className="dashboard-section-head dashboard-section-head--range-top">
              <div>
                <h2 className="section-title">Are we improving?</h2>
                {improvementStorageUri ? (
                  <p className="dashboard-improvement-storage-hint" title={improvementStorageUri}>
                    Cached index: <code>{improvementStorageUri.replace(/^s3:\/\//, '')}</code>
                  </p>
                ) : null}
                {improvementLoading ? (
                  <p className="dashboard-section-loading-hint">Loading chart data in the background…</p>
                ) : null}
              </div>
              <div className="dashboard-chart-range" role="group" aria-label="Chart time range">
                {CHART_RANGE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`dashboard-range-chip ${chartRange === id ? 'dashboard-range-chip--active' : ''}`}
                    onClick={() => setChartRange(id)}
                  >
                    {CHART_RANGE_LABELS[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="dashboard-charts-hero dashboard-charts-hero--single">
              <DashboardImprovementChart
                bins={improvementBins}
                onDrill={handleDrillImprovementByAppVersion}
                loading={improvementLoading}
                registryHint={registryStoryHint}
                windowSessionCount={improvementWindowCount}
                currentConfidencePct={DASHBOARD_STRIP_CURRENT_CONFIDENCE_PCT}
                currentAccuracyPct={DASHBOARD_STRIP_CURRENT_ACCURACY_PCT}
              />
            </div>
            <p className="dashboard-improvement-admin-link">
              <button type="button" className="training-hub-text-btn" onClick={() => navigate('/pipeline-iterations')}>
                Open pipeline iterations registry
              </button>{' '}
              to edit eval rows that power the registry hint.
            </p>
          </section>

        <section className="dashboard-section dashboard-section--glance dashboard-section--action-first">
          <div className="dashboard-section-head">
            <div>
              <h2 className="section-title">At a glance</h2>
              {countsLoading ? (
                <p className="dashboard-section-loading-hint">Loading counts…</p>
              ) : null}
            </div>
          </div>
          <div className="dashboard-kpi-grid">
            <KpiMiniCard
              label="Awaiting review"
              value={kpiCount(glanceCounts.incorrectNewCount, kpiDataLoading)}
              hint="Not human-reviewed yet (folder unchanged today)"
              onClick={() => handleCardClick('incorrect_new')}
              variant="danger"
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Uploaded today"
              value="—"
              hint={`${todayHintDisplay} · open readings for per-day drill-down`}
              onClick={() => handleDrillByDay(todayDrillIso)}
              variant="accent"
              loading={false}
            />
            <KpiMiniCard
              label="Marked correct"
              value={kpiCount(glanceCounts.correctCount, kpiDataLoading)}
              hint={
                glanceCounts.totalPictures > 0
                  ? `${labeledSharePct}% of sessions (folder counts)`
                  : 'No sessions in this filter'
              }
              onClick={() => handleCardClick('correct')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Marked incorrect"
              value={kpiCount(incorrectQueuesTotal, kpiDataLoading)}
              hint="All incorrect pipeline stages"
              onClick={() =>
                navigate(`/readings/incorrect-queues${getChartRangeSearchSuffix(chartRange)}`)
              }
              variant="warning"
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="All sessions"
              value={kpiCount(glanceCounts.totalPictures, kpiDataLoading)}
              hint={
                chartRange === 'all'
                  ? 'Everything in this filter · tap for full list'
                  : 'In selected window · tap for full list'
              }
              onClick={handleViewAllSessions}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Analyzed"
              value={kpiCount(glanceCounts.incorrectAnalyzedCount, kpiDataLoading)}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_analyzed')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Labeled"
              value={kpiCount(glanceCounts.incorrectLabeledCount, kpiDataLoading)}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_labeled')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="In training set"
              value={kpiCount(glanceCounts.incorrectTrainingCount, kpiDataLoading)}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_training')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="No dials"
              value={kpiCount(glanceCounts.noDialsCount, kpiDataLoading)}
              hint="Open list"
              onClick={() => handleCardClick('no_dials')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Not sure"
              value={kpiCount(glanceCounts.notSureCount, kpiDataLoading)}
              hint="Open list"
              onClick={() => handleCardClick('not_sure')}
              loading={kpiDataLoading}
            />
          </div>
        </section>

        {(kpiDataLoading || totalReadingsInRange > 0) && (
          <section className="dashboard-section dashboard-section--status-donut">
            <div className="dashboard-section-head">
              <h2 className="section-title">Sessions by status</h2>
            </div>
            <div className="dashboard-donut-solo">
              {kpiDataLoading ? (
                <div className="chart-empty chart-empty--tight">
                  <Loader2 size={28} className="spin" />
                  <span>Loading status breakdown…</span>
                </div>
              ) : (
                <StatusDonutChart counts={glanceCounts} onSegment={handleCardClick} soloLayout />
              )}
            </div>
          </section>
        )}

        <section className="dashboard-section dashboard-section--model-bars-bottom" aria-label="App version accuracy">
          <ModelVersionAccuracyBars
            versions={modelVersions}
            loading={improvementLoading}
            onOpenModels={() => navigate('/models')}
            onBrowseVersion={(appVersion) => {
              const suffix = getChartRangeSearchSuffix(chartRange);
              const conn = suffix ? `${suffix}&` : '?';
              navigate(`/readings/all${conn}appVersion=${encodeURIComponent(appVersion)}`);
            }}
          />
        </section>
      </main>
      )}
    </div>
  );
};

export default Dashboard;
