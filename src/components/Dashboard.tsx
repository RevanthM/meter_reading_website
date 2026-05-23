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
} from 'lucide-react';
import type { DashboardCounts, ReadingStatus, WorkType } from '../types';
import { statusColors, statusLabels, workTypeLabels } from '../types';
import {
  downloadIncorrectRetrainZip,
  fetchPipelineIterations,
  PIPELINE_REGISTRY_UPDATED_EVENT,
  type ImprovementChartRange,
  type PipelineIterationRecord,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { getStoredPortalWorkMode } from '../utils/portalWorkMode';
import { DashboardRoleHome } from './DashboardRoleHome';
import {
  calendarDayKeyInPortalTz,
  formatPortalWeekdayMedium,
  portalDayKeysRollingWindow,
} from '../utils/readingDisplayDates';
import {
  enrichIterationRegistryRows,
} from '../utils/iterationMetricsEnrichment';
import DashboardTrainingAnalyticsSection from './DashboardTrainingAnalyticsSection';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';

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

/** Time window for dashboard volume + labeled-share charts (drill-down by day still works). */
type ChartRangeId = ImprovementChartRange;

const CHART_RANGE_DAY_COUNT: Record<Exclude<ChartRangeId, 'all'>, number> = {
  '1d': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
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
  const [chartRange] = useState<ChartRangeId>('all');
  const [registryIterations, setRegistryIterations] = useState<PipelineIterationRecord[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [pipelineLineFilter, setPipelineLineFilter] = useState<ChartPipelineFilter>('all');

  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalRole = outletCtx?.workMode ?? getStoredPortalWorkMode();
  const isAdminDashboard = portalRole === 'admin';
  const isModelTrainer = portalRole === 'labeler';
  const showTrainingAnalytics = isAdminDashboard || isModelTrainer;

  const glanceCounts = counts;
  const kpiDataLoading = countsLoading;

  const enrichedRegistryAll = useMemo(
    () => enrichIterationRegistryRows(registryIterations),
    [registryIterations],
  );

  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true);
    try {
      const doc = await fetchPipelineIterations();
      setRegistryIterations(doc.iterations ?? []);
    } catch {
      setRegistryIterations([]);
    } finally {
      setRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showTrainingAnalytics) {
      setRegistryIterations([]);
      setRegistryLoading(false);
      return;
    }

    let cancelled = false;
    void loadRegistry().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [showTrainingAnalytics, loadRegistry]);

  useEffect(() => {
    if (!showTrainingAnalytics) return;
    const onRegistryUpdated = () => {
      void loadRegistry();
    };
    window.addEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
    return () => window.removeEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
  }, [showTrainingAnalytics, loadRegistry]);

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

  const handleDrillByDay = (isoDay: string) => {
    navigate(`/readings/all?date=${encodeURIComponent(isoDay)}`);
  };

  const labeledSharePct =
    glanceCounts.totalPictures > 0
      ? Math.round((glanceCounts.correctCount / glanceCounts.totalPictures) * 1000) / 10
      : 0;

  const refreshDashboardLight = useCallback(async () => {
    await refreshCounts();
    if (!showTrainingAnalytics) return;
    await loadRegistry();
  }, [showTrainingAnalytics, loadRegistry, refreshCounts]);

  const dashboardSubtitle = isAdminDashboard
    ? 'Analytics, registry & full queue overview'
    : portalRole === 'reviewer'
      ? 'Review queue & outcomes'
      : portalRole === 'test_data_reviewer'
        ? 'Test data approval'
        : 'Pipeline metrics by iteration';

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
                  showTrainingAnalytics
                    ? 'Refresh counts and cached charts (does not reload all sessions)'
                    : 'Refresh folder counts'
                }
                aria-busy={countsLoading || (showTrainingAnalytics && registryLoading)}
              >
                <RefreshCw
                  size={17}
                  className={countsLoading || (showTrainingAnalytics && registryLoading) ? 'spin' : ''}
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

      {!isAdminDashboard && !isModelTrainer ? (
        <DashboardRoleHome
          role={portalRole}
          counts={glanceCounts}
          countsLoading={kpiDataLoading}
          incorrectQueuesTotal={incorrectQueuesTotal}
        />
      ) : null}

      {isModelTrainer ? (
        <main className="dashboard-content dashboard-content--visual dashboard-content--trainer-graphs">
          <DashboardTrainingAnalyticsSection
            rows={enrichedRegistryAll}
            loading={registryLoading}
            pipelineFilter={pipelineLineFilter}
            onPipelineFilterChange={setPipelineLineFilter}
            isAdmin={false}
            showPerDial
            graphsOnly
          />
        </main>
      ) : null}

      {isAdminDashboard ? (
      <main className="dashboard-content dashboard-content--visual">
        <DashboardTrainingAnalyticsSection
          rows={enrichedRegistryAll}
          loading={registryLoading}
          pipelineFilter={pipelineLineFilter}
          onPipelineFilterChange={setPipelineLineFilter}
          isAdmin
          onOpenRegistry={() => navigate('/pipeline-iterations')}
        />

        <section className="dashboard-section dashboard-section--glance dashboard-section--action-first">
          <div className="dashboard-section-head dashboard-section-head--inline">
            <div>
              <h2 className="section-title">Operations</h2>
              <p className="dashboard-section-sub">
                Live S3 session queues for the selected work type and source.{' '}
                <button type="button" className="training-hub-text-btn" onClick={() => navigate('/usage')}>
                  App usage by day →
                </button>
              </p>
              {countsLoading ? (
                <p className="dashboard-section-loading-hint">Loading counts…</p>
              ) : null}
            </div>
          </div>
          <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
            <KpiMiniCard
              label="Awaiting review"
              value={kpiCount(glanceCounts.incorrectNewCount, kpiDataLoading)}
              hint="Not human-reviewed yet"
              onClick={() => handleCardClick('incorrect_new')}
              variant="danger"
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Uploaded today"
              value={kpiCount(glanceCounts.uploadedTodayCount ?? 0, kpiDataLoading)}
              hint={`${todayHintDisplay} · drill down by day`}
              onClick={() => handleDrillByDay(todayDrillIso)}
              variant="accent"
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Marked correct"
              value={kpiCount(glanceCounts.correctCount, kpiDataLoading)}
              hint={
                glanceCounts.totalPictures > 0
                  ? `${labeledSharePct}% of sessions`
                  : 'No sessions in this filter'
              }
              onClick={() => handleCardClick('correct')}
              loading={kpiDataLoading}
            />
            <KpiMiniCard
              label="Incorrect (all stages)"
              value={kpiCount(incorrectQueuesTotal, kpiDataLoading)}
              hint="New → analyzed → labeled → training"
              onClick={() =>
                navigate(`/readings/incorrect-queues${getChartRangeSearchSuffix(chartRange)}`)
              }
              variant="warning"
              loading={kpiDataLoading}
            />
          </div>
        </section>

        {(kpiDataLoading || totalReadingsInRange > 0) && (
          <section className="dashboard-section dashboard-section--status-donut">
            <div className="dashboard-section-head dashboard-section-head--inline">
              <div>
                <h2 className="section-title">Sessions by status</h2>
                <p className="dashboard-section-sub">
                  Share of sessions in this filter — same data as the KPI cards above, as a breakdown.
                </p>
              </div>
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

      </main>
      ) : null}
    </div>
  );
};

export default Dashboard;
