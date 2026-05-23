import { useMemo, useState, type FC, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
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

const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

function pctTooltip(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
}

function imagesTooltip(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : '—';
}

type MetricLineCardProps = {
  title: string;
  rows: AppLineChartRow[];
  series: AppLineChartSeries[];
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
  yDomain,
  yFormatter,
  valueFormatter,
  deltaStrip,
  compact = false,
  reportCapture,
  reportSection,
}) => {
  const hasData = rows.length > 0 && series.length > 0;
  const plotHeight = compact ? 168 : 260;
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
        <h4 className="analytics-chart-card__title">{title}</h4>
        {deltaStrip}
      </header>
      {hasData ? (
        <div className="analytics-chart-card__plot">
          <ResponsiveContainer width="100%" height={plotHeight}>
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
              <XAxis dataKey="iterationLabel" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={yDomain} tickFormatter={yFormatter} width={42} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, name: string) => [valueFormatter(v), name]}
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
                  dot={{ r: 3.5, fill: s.stroke, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
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
  const confidenceChart = useMemo(
    () => (chartsReady ? buildAppMetricLineChart(rows, pipelineFilter, 'confidence') : null),
    [rows, pipelineFilter, chartsReady],
  );
  const accuracyChart = useMemo(
    () => (chartsReady ? buildAppMetricLineChart(rows, pipelineFilter, 'accuracy') : null),
    [rows, pipelineFilter, chartsReady],
  );
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
                title="Training images"
                rows={imagesChart?.chartRows ?? []}
                series={imagesChart?.series ?? []}
              yFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              valueFormatter={imagesTooltip}
              deltaStrip={
                <DashboardTrendDeltaStrip rows={rows} pipelineFilter={pipelineFilter} metric="images" />
              }
              reportCapture="Training images"
              reportSection="Progress"
            />
            <MetricLineCard
              title="App confidence"
              rows={confidenceChart?.chartRows ?? []}
              series={confidenceChart?.series ?? []}
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
              rows={accuracyChart?.chartRows ?? []}
              series={accuracyChart?.series ?? []}
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
              className="analytics-progress-dial-section"
              data-report-capture="Per-dial accuracy trends"
              data-report-section="Progress"
            >
              <header className="analytics-progress-dial-section__head">
                <h4>Per-dial accuracy</h4>
                <p>App read accuracy by dial over iterations.</p>
              </header>
              <div className="analytics-progress-dial-grid">
                {(perDialAccuracyCharts ?? []).map(({ dial, chart }) => (
                  <MetricLineCard
                    key={`acc-d${dial}`}
                    title={`Dial ${dial}`}
                    rows={chart.chartRows}
                    series={chart.series}
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
              <div className="analytics-progress-dial-grid">
                {(perDialConfidenceCharts ?? []).map(({ dial, chart }) => (
                  <MetricLineCard
                    key={`conf-d${dial}`}
                    title={`Dial ${dial}`}
                    rows={chart.chartRows}
                    series={chart.series}
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
                <p className="analytics-empty-state">No per-dial metrics in registry yet.</p>
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
        App metrics from linked iOS unit-test CSVs · Sempra (blue) · Anica (violet) · Combined (green)
      </footer>
    </div>
  );
};

export default DashboardPipelineEssentials;
