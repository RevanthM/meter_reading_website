import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
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
  ClipboardCheck,
  Inbox,
} from 'lucide-react';
import type { DashboardCounts, ReadingStatus, WorkType } from '../types';
import { statusColors, statusLabels, workTypeLabels } from '../types';
import {
  downloadIncorrectRetrainZip,
  fetchModelAnalytics,
  fetchPipelineIterations,
  type ModelVersionStats,
  type PipelineIterationRecord,
  type S3MeterReading,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { buildImprovementStoryBinsByAppVersion } from '../utils/dashboardImprovementStats';
import DashboardImprovementChart from './DashboardImprovementChart';

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
};

const KpiMiniCard: FC<KpiMiniProps> = ({ label, value, hint, onClick, variant = 'default', disabled }) => (
  <button
    type="button"
    className={['dashboard-kpi-item', variant !== 'default' ? `dashboard-kpi-item--${variant}` : ''].join(' ')}
    onClick={onClick}
    disabled={disabled}
  >
    <span className="dashboard-kpi-label">{label}</span>
    <span className="dashboard-kpi-value">{value}</span>
    {hint ? <span className="dashboard-kpi-hint">{hint}</span> : null}
  </button>
);

const ModelVersionAccuracyBars: FC<{
  versions: ModelVersionStats[];
  loading: boolean;
  onOpenModels: () => void;
  /** Open all-readings list filtered to this metadata app_version (respects chart time window). */
  onBrowseVersion?: (appVersion: string) => void;
}> = ({ versions, loading, onOpenModels, onBrowseVersion }) => {
  const rows = useMemo(() => versions.slice(0, 10), [versions]);

  return (
    <div className="chart-card chart-card--hero chart-card--model-bars">
      <div className="chart-header chart-header--stack chart-header--model">
        <div className="chart-header-titles">
          <div className="chart-header-row">
            <Cpu size={18} />
            <h3>Per app version</h3>
          </div>
          <p className="chart-explainer">
            Share of sessions in the <strong>correct</strong> queue by on-device <strong>app_version</strong> (same
            toolbar filters). Each row also shows <strong>average session confidence</strong> from metadata when present.
            Open the Models page for tables and exports.
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
type ChartRangeId = 'all' | '1d' | '7d' | '14d' | '30d';

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

/** Sessions whose upload day falls in the chart chip window (same logic as trend charts). */
function filterReadingsByChartRange(readings: S3MeterReading[], rangeId: ChartRangeId): S3MeterReading[] {
  if (rangeId === 'all') return readings;
  const n = CHART_RANGE_DAY_COUNT[rangeId];
  const now = new Date();
  const daySet = new Set<string>();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    daySet.add(d.toISOString().split('T')[0]);
  }
  return readings.filter((r) => {
    const day = (r.dateOfReading || '').split('T')[0];
    return Boolean(day && daySet.has(day));
  });
}

/** Query string so the readings list matches the chart chip window (`from`/`to` on upload day, inclusive). */
function getChartRangeSearchSuffix(rangeId: ChartRangeId): string {
  if (rangeId === 'all') return '';
  const n = CHART_RANGE_DAY_COUNT[rangeId];
  const now = new Date();
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  const from = days[0];
  const to = days[days.length - 1];
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function deriveCountsFromReadings(readings: S3MeterReading[]): DashboardCounts {
  return {
    totalPictures: readings.length,
    correctCount: readings.filter((r) => r.status === 'correct').length,
    incorrectNewCount: readings.filter((r) => r.status === 'incorrect_new').length,
    incorrectAnalyzedCount: readings.filter((r) => r.status === 'incorrect_analyzed').length,
    incorrectLabeledCount: readings.filter((r) => r.status === 'incorrect_labeled').length,
    incorrectTrainingCount: readings.filter((r) => r.status === 'incorrect_training').length,
    noDialsCount: readings.filter((r) => r.status === 'no_dials').length,
    notSureCount: readings.filter((r) => r.status === 'not_sure').length,
  };
}

const Dashboard: FC = () => {
  const {
    loading,
    error,
    isUsingRealData,
    refreshData,
    dataSource,
    setDataSource,
    workType,
    setWorkType,
    filteredReadings,
  } = useReadings();
  const [zipExporting, setZipExporting] = useState(false);
  const [chartRange, setChartRange] = useState<ChartRangeId>('all');
  const [modelVersions, setModelVersions] = useState<ModelVersionStats[]>([]);
  const [modelAnalyticsLoading, setModelAnalyticsLoading] = useState(false);
  const [registryIterations, setRegistryIterations] = useState<PipelineIterationRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    setModelAnalyticsLoading(true);
    fetchModelAnalytics(dataSource, workType)
      .then((res) => {
        if (!cancelled) setModelVersions(res.versions ?? []);
      })
      .catch(() => {
        if (!cancelled) setModelVersions([]);
      })
      .finally(() => {
        if (!cancelled) setModelAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, workType]);

  const rangeReadings = useMemo(
    () => filterReadingsByChartRange(filteredReadings, chartRange),
    [filteredReadings, chartRange],
  );
  const rangeCounts = useMemo(() => deriveCountsFromReadings(rangeReadings), [rangeReadings]);

  const improvementBins = useMemo(
    () => buildImprovementStoryBinsByAppVersion(rangeReadings, { maxVersions: 16 }),
    [rangeReadings],
  );

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

  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const isReviewerMode = outletCtx?.workMode !== 'labeler';

  useEffect(() => {
    let cancelled = false;
    fetchPipelineIterations()
      .then((doc) => {
        if (!cancelled) setRegistryIterations(doc.iterations ?? []);
      })
      .catch(() => {
        if (!cancelled) setRegistryIterations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const todayDrillIso = new Date().toISOString().split('T')[0];
  const todayHintDisplay = new Date(`${todayDrillIso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const todayUploadTotal = useMemo(() => {
    const key = new Date().toISOString().split('T')[0];
    return filteredReadings.filter((r) => (r.dateOfReading || '').split('T')[0] === key).length;
  }, [filteredReadings]);

  const incorrectQueuesTotal = useMemo(
    () =>
      rangeCounts.incorrectNewCount +
      rangeCounts.incorrectAnalyzedCount +
      rangeCounts.incorrectLabeledCount +
      rangeCounts.incorrectTrainingCount,
    [rangeCounts],
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
    rangeReadings.length > 0
      ? Math.round((rangeCounts.correctCount / rangeReadings.length) * 1000) / 10
      : 0;

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

  const totalReadingsInRange = rangeCounts.totalPictures;

  const sourceOptions: { value: DataSource; label: string; icon: ReactNode }[] = [
    { value: 'all', label: 'All Sources', icon: <Layers size={14} /> },
    { value: 'field', label: 'Field', icon: <Radio size={14} /> },
    { value: 'simulator', label: 'Simulator', icon: <Monitor size={14} /> },
  ];

  const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-toolbar dashboard-toolbar--loading">
          <div className="dashboard-toolbar-inner">
            <div className="dashboard-toolbar-main">
              <div className="logo">
                <Gauge size={36} strokeWidth={1.5} />
                <div>
                  <h1>Meter Reading</h1>
                  <p>Labeling queue, exports & trends</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <main className="dashboard-content">
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading data from S3...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-inner">
          <div className="dashboard-toolbar-main">
            <div className="logo">
              <Gauge size={36} strokeWidth={1.5} />
              <div>
                <h1>Meter Reading</h1>
                <p>Labeling queue, exports & trends</p>
              </div>
            </div>
            <div className="header-actions">
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
              <div className={`data-source data-source--pill ${isUsingRealData ? 'real' : 'mock'}`}>
                {isUsingRealData ? <Cloud size={15} /> : <HardDrive size={15} />}
                <span>{isUsingRealData ? 'S3' : 'Mock'}</span>
              </div>
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
              <button type="button" className="refresh-button" onClick={refreshData} title="Refresh data">
                <RefreshCw size={17} />
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

      {isReviewerMode ? (
        <div className="dashboard-reviewer-strip" role="region" aria-label="Reviewer quick start">
          <div className="dashboard-reviewer-strip-icon" aria-hidden>
            <ClipboardCheck size={22} strokeWidth={2} />
          </div>
          <div className="dashboard-reviewer-strip-body">
            <strong>Reviewer</strong>
            <span className="dashboard-reviewer-strip-dash">—</span>
            <span>
              Open <strong>Awaiting review</strong> for captures that are <strong>not manually reviewed</strong> yet (
              <code>is_manually_reviewed</code> in metadata; legacy <code>is_human_reviewed</code> is still honored).
              Everything else is <strong>reviewed outcomes</strong> (wrong pipeline, correct, etc.). Optional:{' '}
              <strong>Recommend for training</strong> for labelers.
            </span>
          </div>
          <button
            type="button"
            className="dashboard-reviewer-strip-cta"
            onClick={() => navigate(`/readings/incorrect_new${getChartRangeSearchSuffix(chartRange)}`)}
          >
            <Inbox size={18} aria-hidden />
            Awaiting review
          </button>
        </div>
      ) : null}

      <main className="dashboard-content dashboard-content--visual">
        {filteredReadings.length > 0 && (
          <section className="dashboard-section dashboard-section--viz dashboard-section--improvement">
            <div className="dashboard-section-head dashboard-section-head--range-top">
              <div>
                <h2 className="section-title">Are we improving?</h2>
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
                loading={false}
                registryHint={registryStoryHint}
              />
            </div>
            {outletCtx?.workMode === 'admin' ? (
              <p className="dashboard-improvement-admin-link">
                <button type="button" className="training-hub-text-btn" onClick={() => navigate('/pipeline-iterations')}>
                  Open pipeline iterations registry
                </button>{' '}
                to edit eval rows that power the registry hint.
              </p>
            ) : null}
          </section>
        )}

        <section className="dashboard-section dashboard-section--glance dashboard-section--action-first">
          <div
            className={
              filteredReadings.length === 0
                ? 'dashboard-section-head dashboard-section-head--range-top'
                : 'dashboard-section-head'
            }
          >
            <div>
              <h2 className="section-title">At a glance</h2>
            </div>
            {filteredReadings.length === 0 ? (
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
            ) : null}
          </div>
          <div className="dashboard-kpi-grid">
            <KpiMiniCard
              label="Awaiting review"
              value={rangeCounts.incorrectNewCount.toLocaleString()}
              hint="Not human-reviewed yet (folder unchanged today)"
              onClick={() => handleCardClick('incorrect_new')}
              variant="danger"
            />
            <KpiMiniCard
              label="Uploaded today"
              value={todayUploadTotal.toLocaleString()}
              hint={todayHintDisplay}
              onClick={() => handleDrillByDay(todayDrillIso)}
              variant="accent"
            />
            <KpiMiniCard
              label="Marked correct"
              value={rangeCounts.correctCount.toLocaleString()}
              hint={
                rangeReadings.length > 0
                  ? `${labeledSharePct}% ${chartRange === 'all' ? 'of this filter' : 'in this window'}`
                  : chartRange === 'all'
                    ? 'No readings loaded'
                    : 'No readings in this window'
              }
              onClick={() => handleCardClick('correct')}
            />
            <KpiMiniCard
              label="Marked incorrect"
              value={incorrectQueuesTotal.toLocaleString()}
              hint="All incorrect pipeline stages"
              onClick={() =>
                navigate(`/readings/incorrect-queues${getChartRangeSearchSuffix(chartRange)}`)
              }
              variant="warning"
            />
            <KpiMiniCard
              label="All sessions"
              value={rangeCounts.totalPictures.toLocaleString()}
              hint={
                chartRange === 'all'
                  ? 'Everything in this filter · tap for full list'
                  : 'In selected window · tap for full list'
              }
              onClick={handleViewAllSessions}
            />
            <KpiMiniCard
              label="Analyzed"
              value={rangeCounts.incorrectAnalyzedCount.toLocaleString()}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_analyzed')}
            />
            <KpiMiniCard
              label="Labeled"
              value={rangeCounts.incorrectLabeledCount.toLocaleString()}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_labeled')}
            />
            <KpiMiniCard
              label="In training set"
              value={rangeCounts.incorrectTrainingCount.toLocaleString()}
              hint="Open list"
              onClick={() => handleCardClick('incorrect_training')}
            />
            <KpiMiniCard
              label="No dials"
              value={rangeCounts.noDialsCount.toLocaleString()}
              hint="Open list"
              onClick={() => handleCardClick('no_dials')}
            />
            <KpiMiniCard
              label="Not sure"
              value={rangeCounts.notSureCount.toLocaleString()}
              hint="Open list"
              onClick={() => handleCardClick('not_sure')}
            />
          </div>
        </section>

        {totalReadingsInRange > 0 && (
          <section className="dashboard-section dashboard-section--status-donut">
            <div className="dashboard-section-head">
              <h2 className="section-title">Sessions by status</h2>
            </div>
            <div className="dashboard-donut-solo">
              <StatusDonutChart counts={rangeCounts} onSegment={handleCardClick} soloLayout />
            </div>
          </section>
        )}

        <section className="dashboard-section dashboard-section--model-bars-bottom" aria-label="App version accuracy">
          <ModelVersionAccuracyBars
            versions={modelVersions}
            loading={modelAnalyticsLoading}
            onOpenModels={() => navigate('/models')}
            onBrowseVersion={(appVersion) => {
              const suffix = getChartRangeSearchSuffix(chartRange);
              const conn = suffix ? `${suffix}&` : '?';
              navigate(`/readings/all${conn}appVersion=${encodeURIComponent(appVersion)}`);
            }}
          />
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
