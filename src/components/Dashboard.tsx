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
  TrendingUp,
  BarChart3,
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
  type ModelVersionStats,
  type S3MeterReading,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';

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
            toolbar filters). Open the Models page for tables and exports.
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

/** Every calendar day from start through end (inclusive), ISO yyyy-mm-dd. */
function enumerateIsoDaysInclusive(startIsoDay: string, endIsoDay: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startIsoDay}T12:00:00`);
  const end = new Date(`${endIsoDay}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) return out;
  while (cur <= end) {
    out.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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

function computeChartData(readings: S3MeterReading[], rangeId: ChartRangeId) {
  let days: string[];

  if (rangeId === 'all') {
    const seen = new Set<string>();
    for (const r of readings) {
      const day = r.dateOfReading?.split('T')[0];
      if (day) seen.add(day);
    }
    const sorted = [...seen].sort();
    if (sorted.length === 0) {
      return { dailyData: [], activeDays: [] };
    }
    days = enumerateIsoDaysInclusive(sorted[0], sorted[sorted.length - 1]);
  } else {
    const n = CHART_RANGE_DAY_COUNT[rangeId];
    const now = new Date();
    days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
  }

  const dayMap = new Map<string, { total: number; correct: number; field: number; simulator: number }>();
  for (const day of days) {
    dayMap.set(day, { total: 0, correct: 0, field: 0, simulator: 0 });
  }

  for (const r of readings) {
    const day = r.dateOfReading?.split('T')[0];
    if (!day) continue;
    const entry = dayMap.get(day);
    if (entry) {
      entry.total++;
      if (r.status === 'correct') entry.correct++;
      if (r.type === 'field') entry.field++;
      else entry.simulator++;
    }
  }

  const dailyData = days.map((day) => {
    const d = dayMap.get(day)!;
    return { date: day, ...d, accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : null };
  });

  const activeDays = dailyData.filter((d) => d.total > 0);

  return { dailyData, activeDays };
}

/** When there are more calendar days than this, volume + labeled-share charts use week buckets (Monday start). */
const CHART_BUCKET_WEEK_THRESHOLD = 45;

type ChartBin = {
  date: string;
  drillIso: string;
  total: number;
  correct: number;
  field: number;
  simulator: number;
  accuracy: number | null;
  /** X-axis label under the bar; defaults from `date` when omitted. */
  barLabel?: string;
};

function mondayOfWeekContaining(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00`);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function dailyRowsToChartBins(
  daily: ReturnType<typeof computeChartData>['dailyData'],
): ChartBin[] {
  return daily.map((row) => ({
    date: row.date,
    drillIso: row.date,
    total: row.total,
    correct: row.correct,
    field: row.field,
    simulator: row.simulator,
    accuracy: row.accuracy,
  }));
}

function aggregateDailyBinsToWeeks(daily: ChartBin[]): ChartBin[] {
  const map = new Map<string, { total: number; correct: number; field: number; simulator: number }>();
  for (const row of daily) {
    const mon = mondayOfWeekContaining(row.date);
    const cur = map.get(mon) ?? { total: 0, correct: 0, field: 0, simulator: 0 };
    cur.total += row.total;
    cur.correct += row.correct;
    cur.field += row.field;
    cur.simulator += row.simulator;
    map.set(mon, cur);
  }
  const keys = [...map.keys()].sort();
  return keys.map((mon) => {
    const w = map.get(mon)!;
    const accuracy = w.total > 0 ? Math.round((w.correct / w.total) * 100) : null;
    const barLabel = new Date(`${mon}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });
    return {
      date: mon,
      drillIso: mon,
      total: w.total,
      correct: w.correct,
      field: w.field,
      simulator: w.simulator,
      accuracy,
      barLabel,
    };
  });
}

function buildChartBinsFromDaily(dailyData: ReturnType<typeof computeChartData>['dailyData']): {
  bucket: 'day' | 'week';
  volumeBars: ChartBin[];
  accuracySeries: ChartBin[];
} {
  if (dailyData.length <= CHART_BUCKET_WEEK_THRESHOLD) {
    const bins = dailyRowsToChartBins(dailyData);
    return {
      bucket: 'day',
      volumeBars: bins,
      accuracySeries: bins.filter((b) => b.total > 0),
    };
  }
  const weekly = aggregateDailyBinsToWeeks(dailyRowsToChartBins(dailyData));
  return {
    bucket: 'week',
    volumeBars: weekly,
    accuracySeries: weekly.filter((b) => b.total > 0),
  };
}

const DailyVolumeChart: FC<{
  data: ChartBin[];
  bucket: 'day' | 'week';
  onDayClick?: (isoDay: string) => void;
  hero?: boolean;
  timeRangeLabel: string;
}> = ({ data, bucket, onDayClick, hero, timeRangeLabel }) => {
  const maxCount = Math.max(...data.map((d) => d.total), 1);
  const dense = data.length > 14;
  const title = bucket === 'week' ? 'Weekly upload volume' : 'Daily upload volume';
  const drillHint =
    bucket === 'week'
      ? 'weekly totals · bar opens list filtered to that Monday (week start)'
      : 'click a bar to open that day';

  return (
    <div className={hero ? 'chart-card chart-card--hero' : 'chart-card'}>
      <div className="chart-header">
        <BarChart3 size={18} />
        <h3>{title}</h3>
        <span className="chart-subtitle">
          {timeRangeLabel} · {drillHint}
        </span>
      </div>
      <div className={`chart-bar-area ${dense ? 'chart-bar-area--dense' : ''}`}>
        {data.map((day) => {
          const canDrill = Boolean(onDayClick && day.total > 0);
          const label =
            day.barLabel ??
            new Date(`${day.date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });
          const inner = (
            <>
              <div className="chart-bar-track">
                {day.total > 0 && <div className="chart-bar-tooltip">{day.total}</div>}
                <div
                  className="chart-bar-fill"
                  style={{ height: `${(day.total / maxCount) * 100}%` }}
                >
                  {day.field > 0 && (
                    <div
                      className="chart-bar-segment field"
                      style={{ height: `${(day.field / day.total) * 100}%` }}
                    />
                  )}
                  {day.simulator > 0 && (
                    <div
                      className="chart-bar-segment simulator"
                      style={{ height: `${(day.simulator / day.total) * 100}%` }}
                    />
                  )}
                </div>
              </div>
              <span className="chart-bar-label">{label}</span>
            </>
          );
          return (
            <div key={day.date} className="chart-bar-col">
              {canDrill ? (
                <button
                  type="button"
                  className="chart-bar-hit"
                  onClick={() => onDayClick!(day.drillIso)}
                  title={
                    bucket === 'week'
                      ? `Open sessions for week starting ${day.drillIso}`
                      : `Open sessions uploaded on ${day.drillIso}`
                  }
                >
                  {inner}
                </button>
              ) : (
                <div className="chart-bar-hit chart-bar-hit--disabled">{inner}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chart-legend-row">
        <span className="chart-legend-item"><span className="chart-dot" style={{ background: '#3fb950' }} /> Field</span>
        <span className="chart-legend-item"><span className="chart-dot" style={{ background: '#58a6ff' }} /> Simulator</span>
      </div>
    </div>
  );
};

const AccuracyChart: FC<{
  data: ChartBin[];
  bucket: 'day' | 'week';
  onDayClick?: (isoDay: string) => void;
  hero?: boolean;
  timeRangeLabel: string;
}> = ({ data, bucket, onDayClick, hero, timeRangeLabel }) => {
  const recentDays = data;

  if (recentDays.length === 0) {
    return (
      <div className={hero ? 'chart-card chart-card--hero' : 'chart-card'}>
        <div className="chart-header chart-header--stack">
          <div className="chart-header-titles">
            <div className="chart-header-row">
              <TrendingUp size={18} />
              <h3>{bucket === 'week' ? 'Labeled share by week' : 'Labeled share by day'}</h3>
            </div>
            <p className="chart-explainer chart-explainer--inline">{timeRangeLabel}</p>
          </div>
        </div>
        <div className="chart-empty">No data with readings available</div>
      </div>
    );
  }

  const points = recentDays.map((d, i) => ({
    x: (i / Math.max(recentDays.length - 1, 1)) * 100,
    y: d.accuracy ?? 0,
    date: d.date,
    drillIso: d.drillIso,
    total: d.total,
    correct: d.correct,
  }));

  const polyline = points.map(p => `${p.x},${100 - p.y}`).join(' ');
  const areaPath = `M ${points[0].x},100 ` + points.map(p => `L ${p.x},${100 - p.y}`).join(' ') + ` L ${points[points.length - 1].x},100 Z`;

  const overallCorrect = recentDays.reduce((s, d) => s + d.correct, 0);
  const overallTotal = recentDays.reduce((s, d) => s + d.total, 0);
  const overallAccuracy = overallTotal > 0 ? ((overallCorrect / overallTotal) * 100).toFixed(1) : '0';

  return (
    <div className={hero ? 'chart-card chart-card--hero' : 'chart-card'}>
      <div className="chart-header chart-header--stack">
        <div className="chart-header-titles">
          <div className="chart-header-row">
            <TrendingUp size={18} />
            <h3>{bucket === 'week' ? 'Labeled share by week' : 'Labeled share by day'}</h3>
            <span className="chart-accuracy-badge">{overallAccuracy}%</span>
          </div>
          <p className="chart-explainer">
            Window: <strong>{timeRangeLabel}</strong>. Each point is{' '}
            <strong>
              {bucket === 'week'
                ? 'correct ÷ all sessions uploaded in that week (Mon–Sun bucket)'
                : 'correct ÷ all sessions uploaded that day'}
            </strong>{' '}
            (human labels vs total volume — not model precision until most items are reviewed).
          </p>
          <p className="chart-drill-hint">
            {bucket === 'week'
              ? 'Click a point to open the list for that week (Monday).'
              : 'Click a point to open that day in the list.'}
          </p>
        </div>
      </div>
      <div className="chart-svg-area">
        <svg viewBox="-2 -5 104 115" preserveAspectRatio="none" className="accuracy-svg">
          {[0, 25, 50, 75, 100].map(y => (
            <line key={y} x1="0" y1={100 - y} x2="100" y2={100 - y} stroke="var(--border-color)" strokeWidth="0.5" />
          ))}
          <path d={areaPath} fill="url(#accuracyGradient)" />
          <polyline points={polyline} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => {
            const canDrill = Boolean(onDayClick && p.total > 0);
            return (
              <circle
                key={i}
                cx={p.x}
                cy={100 - p.y}
                r={canDrill ? 4 : 2.5}
                fill="#10b981"
                stroke="var(--bg-tertiary)"
                strokeWidth="1"
                className={canDrill ? 'accuracy-hit' : ''}
                onClick={canDrill ? () => onDayClick!(p.drillIso) : undefined}
                onKeyDown={
                  canDrill
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onDayClick!(p.drillIso);
                        }
                      }
                    : undefined
                }
                tabIndex={canDrill ? 0 : undefined}
                role={canDrill ? 'button' : undefined}
                aria-label={
                  canDrill
                    ? bucket === 'week'
                      ? `Open readings for week starting ${p.drillIso}`
                      : `Open readings for ${p.drillIso}`
                    : undefined
                }
              />
            );
          })}
          <defs>
            <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
          </defs>
        </svg>
        <div className="chart-y-labels">
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
      </div>
      <div className="chart-x-labels">
        {recentDays.length > 0 && (
          <>
            <span>{new Date(recentDays[0].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(recentDays[recentDays.length - 1].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
          </>
        )}
      </div>
    </div>
  );
};

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

  const chartData = useMemo(
    () => computeChartData(filteredReadings, chartRange),
    [filteredReadings, chartRange],
  );

  const chartBins = useMemo(() => buildChartBinsFromDaily(chartData.dailyData), [chartData.dailyData]);

  const rangeReadings = useMemo(
    () => filterReadingsByChartRange(filteredReadings, chartRange),
    [filteredReadings, chartRange],
  );
  const rangeCounts = useMemo(() => deriveCountsFromReadings(rangeReadings), [rangeReadings]);

  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const isReviewerMode = outletCtx?.workMode !== 'labeler';

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
              Open <strong>Awaiting review</strong> for captures that are <strong>not human-reviewed</strong> yet (the app
              will set <code>is_human_reviewed</code> soon). Everything else is <strong>reviewed outcomes</strong> (wrong
              pipeline, correct, etc.). Optional: <strong>Recommend for training</strong> for labelers.
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
        <section className="dashboard-section dashboard-section--glance dashboard-section--action-first">
          <div className="dashboard-section-head dashboard-section-head--range-top">
            <div>
              <h2 className="section-title">At a glance</h2>
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

        {filteredReadings.length > 0 && (
          <section className="dashboard-section dashboard-section--viz">
            <div className="dashboard-section-head">
              <h2 className="section-title">Volume & labeled share</h2>
              <p className="section-lead">
                Window: <strong>{CHART_RANGE_LABELS[chartRange]}</strong> (chips on the At a glance row).{' '}
                {chartBins.bucket === 'week' ? (
                  <>
                    This span has more than {CHART_BUCKET_WEEK_THRESHOLD} days, so charts use <strong>weekly</strong>{' '}
                    buckets (Monday start). Click a bar or point to open the list for that week (Monday filter).
                  </>
                ) : (
                  <>Click a bar or point to open that day in the list.</>
                )}
              </p>
            </div>
            <div className="dashboard-charts-hero">
              <DailyVolumeChart
                data={chartBins.volumeBars}
                bucket={chartBins.bucket}
                onDayClick={handleDrillByDay}
                hero
                timeRangeLabel={CHART_RANGE_LABELS[chartRange]}
              />
              <AccuracyChart
                data={chartBins.accuracySeries}
                bucket={chartBins.bucket}
                onDayClick={handleDrillByDay}
                hero
                timeRangeLabel={CHART_RANGE_LABELS[chartRange]}
              />
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
