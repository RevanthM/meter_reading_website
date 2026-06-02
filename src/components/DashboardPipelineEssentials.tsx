import { useMemo, useState, type FC, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { DotProps } from 'recharts';
import type { PipelineIterationRecord } from '../services/api';
import {
  buildAppMetricLineChart,
  filterEvalChartRows,
  latestPerDialAppMetrics,
  type AppLineChartSeries,
  type AppLineChartRow,
  type ChartPipelineFilter,
} from '../constants/pipelineChartTheme';
import { inferProductLineForRow } from '../constants/factoryStages';
import { buildCurrentSnapshots, latestEvalRowsForPipelineFilter } from '../utils/pipelineAnalyticsStory';
import DashboardProjectSnapshot from './DashboardProjectSnapshot';
import DashboardTrendDeltaStrip from './DashboardTrendDeltaStrip';
import DashboardReportSummaryTable from './DashboardReportSummaryTable';
import DashboardReportIterationBlocks from './DashboardReportIterationBlocks';
import DashboardUnitTestInsights from './DashboardUnitTestInsights';
import DashboardAnalyticsStoryNav, {
  ANALYTICS_SECTION_IDS,
  type AnalyticsStorySection,
} from './DashboardAnalyticsStoryNav';
import PipelineChartLineFilter from './PipelineChartLineFilter';
import DialPctDonut from './DialPctDonut';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

function pctTooltip(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v)
    ? formatPortalAccuracyConfidencePct(v)
    : '—';
}

function datasetDotRadius(imageCount: unknown, imageRange: { min: number; max: number }): number {
  if (typeof imageCount !== 'number' || !Number.isFinite(imageCount)) return 4;
  if (imageRange.max <= imageRange.min) return 8;
  const t = (imageCount - imageRange.min) / (imageRange.max - imageRange.min);
  return 4 + Math.max(0, Math.min(1, t)) * 10;
}

function mergeImageCountsIntoRows(
  metricRows: AppLineChartRow[],
  imageRows: AppLineChartRow[],
  series: AppLineChartSeries[],
): AppLineChartRow[] {
  return metricRows.map((row) => {
    const imgRow = imageRows.find((r) => r.iteration === row.iteration);
    const merged: AppLineChartRow = { ...row };
    for (const s of series) {
      merged[`${s.dataKey}_images`] = (imgRow?.[s.dataKey] as number | null | undefined) ?? null;
    }
    return merged;
  });
}

function imageCountForPayload(payload: AppLineChartRow | undefined, dataKey: string): number | null {
  if (!payload) return null;
  const v = payload[`${dataKey}_images`];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

type SizedDotProps = DotProps & {
  payload?: AppLineChartRow;
  dataKey?: string;
  fill?: string;
  imageRange: { min: number; max: number };
};

function DatasetSizedBubble({ cx, cy, payload, dataKey, fill, imageRange }: SizedDotProps) {
  if (cx == null || cy == null || !dataKey || !payload) return null;
  const raw = payload[dataKey];
  const metric = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(metric)) return null;
  const imgCount = imageCountForPayload(payload, dataKey);
  const r = datasetDotRadius(imgCount, imageRange);
  const color = fill ?? 'currentColor';
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={color}
      stroke={color}
      strokeWidth={1}
      fillOpacity={0.92}
    />
  );
}

function globalImageRange(imageRows: AppLineChartRow[], series: AppLineChartSeries[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    const range = seriesValueRange(imageRows, s.dataKey);
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 1 };
}

function seriesValueRange(rows: AppLineChartRow[], dataKey: string): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const v = row[dataKey];
    if (typeof v === 'number' && Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  return { min, max };
}

type MetricLineCardProps = {
  title: string;
  rows: AppLineChartRow[];
  series: AppLineChartSeries[];
  imageRange?: { min: number; max: number };
  sizeDotsByDataset?: boolean;
  yDomain?: [number, number];
  yFormatter: (v: number) => string;
  valueFormatter: (v: unknown) => string;
  deltaStrip?: ReactNode;
  compact?: boolean;
  reportCapture?: string;
  reportSection?: string;
};

const MetricLineCard: FC<MetricLineCardProps> = ({
  title,
  rows,
  series,
  imageRange = { min: 0, max: 1 },
  sizeDotsByDataset = true,
  yDomain,
  yFormatter,
  valueFormatter,
  deltaStrip,
  compact = false,
  reportCapture,
  reportSection,
}) => {
  const hasData = rows.length > 0 && series.length > 0;
  const plotHeight = compact ? 188 : 280;
  const topMargin = sizeDotsByDataset && !compact ? 28 : compact ? 12 : 22;
  const ChartRoot = sizeDotsByDataset ? ComposedChart : LineChart;
  const captureProps =
    reportCapture != null
      ? {
          'data-report-capture': reportCapture,
          ...(reportSection ? { 'data-report-section': reportSection } : {}),
        }
      : {};
  return (
    <article
      className={`analytics-chart-card${compact ? ' analytics-chart-card--compact' : ''}`}
      {...captureProps}
    >
      <header className="analytics-chart-card__head">
        <div>
          <h4 className="analytics-chart-card__title">{title}</h4>
          {!compact && sizeDotsByDataset ? (
            <p className="analytics-chart-card__subtitle">Circle size reflects training image count</p>
          ) : null}
        </div>
        {deltaStrip}
      </header>
      {hasData ? (
        <div className="analytics-chart-card__plot">
          <ResponsiveContainer width="100%" height={plotHeight}>
            <ChartRoot data={rows} margin={{ top: topMargin, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
              <XAxis dataKey="iterationLabel" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={yDomain} tickFormatter={yFormatter} width={42} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, name: string, item) => {
                  const metric = valueFormatter(v);
                  if (!sizeDotsByDataset) return [metric, name];
                  const payload = item?.payload as AppLineChartRow | undefined;
                  const dataKey = typeof item?.dataKey === 'string' ? item.dataKey : '';
                  const images = dataKey ? imageCountForPayload(payload, dataKey) : null;
                  return images != null
                    ? [`${metric} · ${images.toLocaleString()} training images`, name]
                    : [metric, name];
                }}
                labelFormatter={(label) => `Iteration ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
              {series.map((s) => (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.label}
                  stroke={s.stroke}
                  strokeWidth={2.5}
                  dot={
                    sizeDotsByDataset
                      ? false
                      : { r: 3, fill: s.stroke, strokeWidth: 1.5, stroke: 'var(--bg-elevated, #fff)' }
                  }
                  activeDot={{ r: sizeDotsByDataset ? 8 : 5, fill: s.stroke, strokeWidth: 2, stroke: 'var(--bg-elevated, #fff)' }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {sizeDotsByDataset
                ? series.map((s) => (
                    <Scatter
                      key={`${s.dataKey}-size`}
                      dataKey={s.dataKey}
                      name={s.label}
                      legendType="none"
                      fill={s.stroke}
                      isAnimationActive={false}
                      shape={(props: unknown) => {
                        const p = props as SizedDotProps;
                        return (
                          <DatasetSizedBubble
                            {...p}
                            dataKey={s.dataKey}
                            fill={s.stroke}
                            imageRange={imageRange}
                          />
                        );
                      }}
                    />
                  ))
                : null}
            </ChartRoot>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="analytics-chart-card__empty">No data for this metric yet.</p>
      )}
    </article>
  );
};

const DIAL_NUMBERS = [1, 2, 3, 4] as const;

type Props = {
  rows: PipelineIterationRecord[];
  pipelineFilter?: ChartPipelineFilter;
  onPipelineFilterChange?: (filter: ChartPipelineFilter) => void;
  showPerDial?: boolean;
  showReportSections?: boolean;
  embedPipelineFilter?: boolean;
  renderAllPanels?: boolean;
  showReportCheckbox?: boolean;
  selectedReportIds?: Set<string>;
  onToggleReport?: (id: string) => void;
  reportRows?: PipelineIterationRecord[];
  /** Model trainer: latest iteration per pipeline; pp vs previous only on snapshots. */
  latestScopeOnly?: boolean;
};

const DashboardPipelineEssentials: FC<Props> = ({
  rows,
  pipelineFilter = 'all',
  onPipelineFilterChange,
  showPerDial = true,
  showReportSections = false,
  embedPipelineFilter = false,
  renderAllPanels = false,
  showReportCheckbox = false,
  selectedReportIds,
  onToggleReport,
  reportRows,
  latestScopeOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState<AnalyticsStorySection>('current');

  const chartsReady = renderAllPanels || activeTab === 'progress';
  const allTabReady = renderAllPanels || activeTab === 'all';
  const currentTabReady = renderAllPanels || activeTab === 'current';

  const currentIterationIds = useMemo(
    () => new Set(buildCurrentSnapshots(rows, pipelineFilter).map((c) => c.id)),
    [rows, pipelineFilter],
  );

  const imagesChart = useMemo(
    () => (chartsReady ? buildAppMetricLineChart(rows, pipelineFilter, 'images') : null),
    [rows, pipelineFilter, chartsReady],
  );
  const imageRange = useMemo(() => {
    const chartRows = imagesChart?.chartRows ?? [];
    const chartSeries = imagesChart?.series ?? [];
    return globalImageRange(chartRows, chartSeries);
  }, [imagesChart]);
  const accuracyChart = useMemo(
    () => (chartsReady ? buildAppMetricLineChart(rows, pipelineFilter, 'accuracy') : null),
    [rows, pipelineFilter, chartsReady],
  );
  const confidenceChart = useMemo(
    () => (chartsReady ? buildAppMetricLineChart(rows, pipelineFilter, 'confidence') : null),
    [rows, pipelineFilter, chartsReady],
  );
  const accuracyRows = useMemo(() => {
    if (!accuracyChart || !imagesChart) return [];
    return mergeImageCountsIntoRows(
      accuracyChart.chartRows,
      imagesChart.chartRows,
      accuracyChart.series,
    );
  }, [accuracyChart, imagesChart]);
  const confidenceRows = useMemo(() => {
    if (!confidenceChart || !imagesChart) return [];
    return mergeImageCountsIntoRows(
      confidenceChart.chartRows,
      imagesChart.chartRows,
      confidenceChart.series,
    );
  }, [confidenceChart, imagesChart]);
  const perDialAccuracyCharts = useMemo(
    () =>
      chartsReady
        ? DIAL_NUMBERS.map((dial) => ({
            dial,
            chart: buildAppMetricLineChart(rows, pipelineFilter, 'accuracy', dial),
          }))
        : null,
    [rows, pipelineFilter, chartsReady],
  );
  const perDialConfidenceCharts = useMemo(
    () =>
      chartsReady
        ? DIAL_NUMBERS.map((dial) => ({
            dial,
            chart: buildAppMetricLineChart(rows, pipelineFilter, 'confidence', dial),
          }))
        : null,
    [rows, pipelineFilter, chartsReady],
  );
  const dialMetrics = useMemo(
    () => (allTabReady ? latestPerDialAppMetrics(rows, pipelineFilter) : []),
    [rows, pipelineFilter, allTabReady],
  );

  const hasDialData = dialMetrics.some((d) => d.accuracy != null || d.confidence != null);
  const reportIterationRows = reportRows ?? rows;
  const allTabIterationRows = useMemo(() => {
    if (latestScopeOnly) {
      return latestEvalRowsForPipelineFilter(rows, pipelineFilter);
    }
    const evalRows = filterEvalChartRows(rows);
    if (pipelineFilter === 'all') return evalRows;
    return evalRows.filter((r) => inferProductLineForRow(r) === pipelineFilter);
  }, [rows, pipelineFilter, latestScopeOnly]);

  const panelClass = (section: AnalyticsStorySection) =>
    `analytics-panel${activeTab === section ? ' analytics-panel--active' : ''}`;

  return (
    <div className="analytics-shell">
      <header className="analytics-shell__header">
        <DashboardAnalyticsStoryNav
          active={activeTab}
          onChange={setActiveTab}
          showReportHint={showReportSections}
        />
        {embedPipelineFilter && onPipelineFilterChange ? (
          <PipelineChartLineFilter
            value={pipelineFilter}
            onChange={onPipelineFilterChange}
            className="analytics-shell__filter"
          />
        ) : null}
      </header>

      <div className="analytics-shell__body">
        <section
          id={ANALYTICS_SECTION_IDS.current}
          role="tabpanel"
          aria-labelledby="analytics-tab-current"
          className={panelClass('current')}
        >
          <DashboardProjectSnapshot
            rows={rows}
            pipelineFilter={pipelineFilter}
            showReportCheckbox={showReportCheckbox}
            selectedReportIds={selectedReportIds}
            onToggleReport={onToggleReport}
            latestScopeOnly={latestScopeOnly}
          />
          {currentTabReady ? (
            <DashboardUnitTestInsights
              rows={rows}
              selectedIterationIds={currentIterationIds}
              confusionOnly
            />
          ) : null}
        </section>

        <section
          id={ANALYTICS_SECTION_IDS.progress}
          role="tabpanel"
          aria-labelledby="analytics-tab-progress"
          className={panelClass('progress')}
        >
          <div className="analytics-progress-grid">
            <MetricLineCard
              title="App confidence"
              rows={confidenceRows}
              series={confidenceChart?.series ?? []}
              imageRange={imageRange}
              yDomain={[55, 100]}
              yFormatter={(v) => `${v}%`}
              valueFormatter={pctTooltip}
              deltaStrip={
                <DashboardTrendDeltaStrip rows={rows} pipelineFilter={pipelineFilter} metric="confidence" />
              }
              reportCapture="App confidence"
              reportSection="Progress"
            />
            <MetricLineCard
              title="App accuracy"
              rows={accuracyRows}
              series={accuracyChart?.series ?? []}
              imageRange={imageRange}
              yDomain={[55, 100]}
              yFormatter={(v) => `${v}%`}
              valueFormatter={pctTooltip}
              deltaStrip={
                <DashboardTrendDeltaStrip rows={rows} pipelineFilter={pipelineFilter} metric="accuracy" />
              }
              reportCapture="App accuracy"
              reportSection="Progress"
            />

            <div
              className="analytics-progress-dial-block"
              data-report-capture="Per-dial accuracy trends"
              data-report-section="Progress"
            >
              <div className="analytics-progress-dial-grid analytics-progress-dial-grid--four">
                {(perDialAccuracyCharts ?? []).map(({ dial, chart }) => (
                  <MetricLineCard
                    key={`acc-d${dial}`}
                    title={`Dial ${dial}`}
                    rows={chart.chartRows}
                    series={chart.series}
                    sizeDotsByDataset={false}
                    yDomain={[55, 100]}
                    yFormatter={(v) => `${v}%`}
                    valueFormatter={pctTooltip}
                    compact
                  />
                ))}
              </div>
            </div>

            <div
              className="analytics-progress-dial-section"
              data-report-capture="Per-dial confidence trends"
              data-report-section="Progress"
            >
              <header className="analytics-progress-dial-section__head">
                <h4>Per-dial confidence</h4>
                <p>App keypoint confidence by dial over iterations.</p>
              </header>
              <div className="analytics-progress-dial-grid analytics-progress-dial-grid--four">
                {(perDialConfidenceCharts ?? []).map(({ dial, chart }) => (
                  <MetricLineCard
                    key={`conf-d${dial}`}
                    title={`Dial ${dial}`}
                    rows={chart.chartRows}
                    series={chart.series}
                    sizeDotsByDataset={false}
                    yDomain={[55, 100]}
                    yFormatter={(v) => `${v}%`}
                    valueFormatter={pctTooltip}
                    compact
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id={ANALYTICS_SECTION_IDS.all}
          role="tabpanel"
          aria-labelledby="analytics-tab-all"
          className={panelClass('all')}
        >
          {showPerDial ? (
            <div className="analytics-details-block">
              <header className="analytics-details-block__head">
                <h4>Per-dial — latest app metrics</h4>
                <p>From the newest iteration in the current pipeline filter.</p>
              </header>
              {hasDialData ? (
                <div className="analytics-donut-sections">
                  <div
                    className="analytics-donut-section"
                    data-report-capture="Per-dial accuracy"
                    data-report-section="All metrics"
                  >
                    <h5>Accuracy</h5>
                    <div className="analytics-donut-grid">
                      {dialMetrics.map((d) => (
                        <DialPctDonut
                          key={`acc-${d.dial}`}
                          dial={d.dial}
                          pct={d.accuracy}
                          metricLabel="accuracy"
                          fill={ACCURACY_FILL}
                        />
                      ))}
                    </div>
                  </div>
                  <div
                    className="analytics-donut-section"
                    data-report-capture="Per-dial confidence"
                    data-report-section="All metrics"
                  >
                    <h5>Confidence</h5>
                    <div className="analytics-donut-grid">
                      {dialMetrics.map((d) => (
                        <DialPctDonut
                          key={`conf-${d.dial}`}
                          dial={d.dial}
                          pct={d.confidence}
                          metricLabel="confidence"
                          fill={CONFIDENCE_FILL}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="analytics-empty-state">No per-dial metrics available yet.</p>
              )}
            </div>
          ) : null}

          {showReportSections ? (
            <>
              <DashboardReportSummaryTable rows={reportIterationRows} />
              <div className="analytics-details-block analytics-details-block--unit-test">
                <DashboardUnitTestInsights
                  rows={rows}
                  selectedIterationIds={selectedReportIds ?? new Set()}
                />
              </div>
              <DashboardReportIterationBlocks
                rows={allTabIterationRows}
                allRowsForDelta={latestScopeOnly ? rows : undefined}
                showReportCheckbox={showReportCheckbox}
                selectedReportIds={selectedReportIds}
                onToggleReport={onToggleReport}
                latestOnly={latestScopeOnly}
              />
            </>
          ) : null}
        </section>
      </div>

      <footer className="analytics-shell__foot">
        From unit test results · Sempra (blue) · Anica (violet) · Combined (green)
      </footer>
    </div>
  );
};

export default DashboardPipelineEssentials;
