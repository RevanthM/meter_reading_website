import { useMemo, type FC } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { UnitTestRunDetailResponse } from '../services/api';
import type { WorkType } from '../types';
import {
  confidenceHistogramFromPerImageRows,
  formatFieldTestDialHoverNote,
  resolveDialStats,
  resolveDifficultyTiers,
  resolveRunPerformance,
} from '../utils/unitTestCsvAnalytics';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';
import UnitTestConfusionHeatmap from './UnitTestConfusionHeatmap';
import type { ConfusionImageSource } from './ConfusionMisreadLightbox';

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

const CORRECT_FILL = '#16a34a';
const INCORRECT_FILL = '#dc2626';
const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';
const CONFIDENCE_STROKE = CONFIDENCE_FILL;

type DifficultyChartRow = {
  tier: string;
  accuracy: number | undefined;
  confidence: number | undefined;
  imageCount: number;
  withGroundTruth: number;
};

function pctDisplay(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v)
    ? formatPortalAccuracyConfidencePct(v)
    : '—';
}

function DifficultyPerformanceTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DifficultyChartRow | undefined;
  if (!row) return null;
  return (
    <div style={tooltipStyle} className="dashboard-unit-test-difficulty-tooltip">
      <p className="dashboard-unit-test-difficulty-tooltip-title">{label}</p>
      <p>
        <strong>{row.imageCount}</strong> images tested
        {row.withGroundTruth > 0 ? ` · ${row.withGroundTruth} with ground truth labels` : ''}
      </p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)}>
          {entry.name}:{' '}
          {typeof entry.value === 'number' ? formatPortalAccuracyConfidencePct(entry.value) : '—'}
        </p>
      ))}
    </div>
  );
}

function DifficultyAxisTick({
  x,
  y,
  payload,
  rows,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  rows: DifficultyChartRow[];
}) {
  if (x == null || y == null || !payload) return null;
  const row = rows.find((r) => r.tier === payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" y={10} fontSize={11} fill="var(--text-primary, #0f172a)">
        {payload.value}
      </text>
      <text textAnchor="middle" y={24} fontSize={9} fill="var(--text-muted, #64748b)">
        {row ? `n = ${row.imageCount}` : ''}
      </text>
    </g>
  );
}

type Props = {
  detail: UnitTestRunDetailResponse;
  /** Per-chart PDF capture (confusion is captured on the Current tab). */
  reportCapture?: boolean;
  confusionImageSource?: ConfusionImageSource;
  workType?: WorkType;
  /** Field test uses reviewer capture accuracy and strict per-dial accuracy labels. */
  metricsMode?: 'unit_test' | 'field_test';
  /** Reviewer-marked incorrect captures — dial fraction denominator (e.g. 12). */
  incorrectCaptureCount?: number;
};

const cardCapture = (enabled: boolean | undefined, label: string) =>
  enabled
    ? {
        'data-report-capture': label,
        'data-report-section': 'Unit test',
      }
    : {};

const DashboardUnitTestCsvCharts: FC<Props> = ({
  detail,
  reportCapture = false,
  confusionImageSource,
  workType,
  metricsMode = 'unit_test',
  incorrectCaptureCount,
}) => {
  const fieldTest = metricsMode === 'field_test';
  const runPerf = useMemo(() => resolveRunPerformance(detail), [detail]);
  const dialStats = useMemo(
    () =>
      resolveDialStats(
        detail,
        fieldTest ? { fieldTest: true, incorrectCaptureCount } : undefined,
      ),
    [detail, fieldTest, incorrectCaptureCount],
  );
  const difficultyTiers = useMemo(() => resolveDifficultyTiers(detail), [detail]);

  const pieData = useMemo(
    () =>
      runPerf.withGroundTruth > 0
        ? [
            { name: 'Correct', value: runPerf.correct, fill: CORRECT_FILL },
            { name: 'Incorrect', value: runPerf.incorrect, fill: INCORRECT_FILL },
          ]
        : [],
    [runPerf],
  );

  const correctIncorrectBar = useMemo(
    () =>
      runPerf.withGroundTruth > 0
        ? [
            { label: 'Correct', count: runPerf.correct, fill: CORRECT_FILL },
            { label: 'Incorrect', count: runPerf.incorrect, fill: INCORRECT_FILL },
          ]
        : [],
    [runPerf],
  );

  const dialAccuracyData = useMemo(
    () =>
      dialStats
        .filter((d) => d.accuracyPct != null && Number.isFinite(d.accuracyPct))
        .map((d) => {
          return {
            dial: `Dial ${d.dial}`,
            accuracy: d.accuracyPct as number,
            hoverNote: fieldTest ? formatFieldTestDialHoverNote(d) : null,
          };
        }),
    [dialStats, fieldTest],
  );

  const dialDualData = useMemo(
    () =>
      dialStats
        .filter(
          (d) =>
            (d.accuracyPct != null && Number.isFinite(d.accuracyPct)) ||
            (d.confidencePct != null && Number.isFinite(d.confidencePct)),
        )
        .map((d) => ({
          dial: `Dial ${d.dial}`,
          accuracy: d.accuracyPct ?? undefined,
          confidence: d.confidencePct ?? undefined,
        })),
    [dialStats],
  );

  const difficultyPerformanceData = useMemo((): DifficultyChartRow[] => {
    return difficultyTiers.map((t) => ({
      tier: t.label,
      accuracy:
        t.accuracyPct != null && Number.isFinite(t.accuracyPct) ? t.accuracyPct : undefined,
      confidence:
        t.confidencePct != null && Number.isFinite(t.confidencePct) ? t.confidencePct : undefined,
      imageCount: t.imageCount,
      withGroundTruth: t.withGroundTruth,
    }));
  }, [difficultyTiers]);

  const hasDifficultyChart = useMemo(
    () =>
      difficultyPerformanceData.some(
        (r) =>
          r.imageCount > 0 &&
          ((r.accuracy != null && Number.isFinite(r.accuracy)) ||
            (r.confidence != null && Number.isFinite(r.confidence))),
      ),
    [difficultyPerformanceData],
  );

  /** Zoom Y-axis so small gaps between tiers are visible (flat 89% lines are hard to read at 0–100). */
  const difficultyYDomain = useMemo((): [number, number] => {
    const vals = difficultyPerformanceData.flatMap((r) =>
      [r.accuracy, r.confidence].filter((v): v is number => v != null && Number.isFinite(v)),
    );
    if (vals.length === 0) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    const pad = span < 8 ? 4 : 8;
    return [Math.max(0, Math.floor(min - pad)), Math.min(100, Math.ceil(max + pad))];
  }, [difficultyPerformanceData]);

  const histogram = useMemo(
    () => (detail.perImageRows?.length ? confidenceHistogramFromPerImageRows(detail.perImageRows) : []),
    [detail.perImageRows],
  );

  const summary = detail.summary;
  const accPct = runPerf.accuracyPct;

  return (
    <div className="dashboard-unit-test-analytics">
      <p className="dashboard-unit-test-run-summary" role="note">
        {summary?.imagesProcessed ?? detail.perImageCount ?? '—'}{' '}
        {fieldTest ? 'captures scored' : 'images'}
        {accPct != null && Number.isFinite(accPct)
          ? fieldTest
            ? ` · ${formatPortalAccuracyConfidencePct(accPct)} read accuracy`
            : ` · ${formatPortalAccuracyConfidencePct(accPct)} full-reading accuracy`
          : ''}
        {summary?.generated_utc ? ` · ${summary.generated_utc}` : ''}
      </p>

      <section className="dashboard-unit-test-analytics-section">
        <h4 className="dashboard-unit-test-analytics-section-title">
          {fieldTest ? 'Read-level performance' : 'Overall model performance'}
        </h4>
        <div className="dashboard-unit-test-analytics-grid dashboard-unit-test-analytics-grid--2">
          <div className="dashboard-pipeline-essential-card" {...cardCapture(reportCapture, 'UT — Accuracy gauge')}>
            <h5>Accuracy gauge</h5>
            {pieData.length > 0 && accPct != null ? (
              <div className="dashboard-unit-test-donut-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="58%"
                      outerRadius="82%"
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dashboard-unit-test-donut-center" aria-hidden>
                  <span className="dashboard-unit-test-donut-pct">
                    {formatPortalAccuracyConfidencePct(accPct)}
                  </span>
                  <span className="dashboard-unit-test-donut-label">
                    {fieldTest ? 'read accuracy' : 'overall accuracy'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">No ground-truth readings in these results.</p>
            )}
          </div>

          <div className="dashboard-pipeline-essential-card" {...cardCapture(reportCapture, 'UT — Correct vs incorrect')}>
            <h5>{fieldTest ? 'Correct vs incorrect captures' : 'Correct vs incorrect readings'}</h5>
            {correctIncorrectBar.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={correctIncorrectBar} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} width={36} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                    {correctIncorrectBar.map((entry) => (
                      <Cell key={entry.label} fill={entry.fill} />
                    ))}
                    <LabelList dataKey="count" position="top" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">No ground-truth readings in these results.</p>
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-unit-test-analytics-section">
        <h4 className="dashboard-unit-test-analytics-section-title">Per-dial analysis</h4>
        <div className="dashboard-unit-test-analytics-grid dashboard-unit-test-analytics-grid--2">
          <div className="dashboard-pipeline-essential-card" {...cardCapture(reportCapture, 'UT — Dial accuracy')}>
            <h5>{fieldTest ? 'Dial accuracy (strict)' : 'Dial accuracy comparison'}</h5>
            {dialAccuracyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={dialAccuracyData}
                  margin={{ top: 12, right: 8, left: 8, bottom: 4 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="dial" type="category" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, _name, item) => {
                      const row = item?.payload as { hoverNote?: string | null } | undefined;
                      if (fieldTest && row?.hoverNote) return [row.hoverNote, 'Dial accuracy'];
                      return [formatPortalAccuracyConfidencePct(v), 'Dial accuracy'];
                    }}
                  />
                  <Bar dataKey="accuracy" fill={ACCURACY_FILL} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">No per-dial ground truth in these results.</p>
            )}
          </div>

          <div className="dashboard-pipeline-essential-card" {...cardCapture(reportCapture, 'UT — Dial confidence vs accuracy')}>
            <h5>Dial confidence vs accuracy</h5>
            {dialDualData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={dialDualData} margin={{ top: 20, right: 48, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="dial" type="category" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="acc"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                    label={{ value: 'Accuracy', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748b' }}
                  />
                  <YAxis
                    yAxisId="conf"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                    label={{ value: 'Confidence', angle: 90, position: 'insideRight', fontSize: 10, fill: '#64748b' }}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="acc"
                    dataKey="accuracy"
                    name="Accuracy"
                    fill={ACCURACY_FILL}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="conf"
                    type="monotone"
                    dataKey="confidence"
                    name="Avg confidence"
                    stroke={CONFIDENCE_STROKE}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 1.5, stroke: 'var(--bg-elevated, #fff)' }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">No per-dial metrics in these results.</p>
            )}
          </div>
        </div>
      </section>

      {difficultyTiers.length > 0 ? (
        <section className="dashboard-unit-test-analytics-section">
          <h4 className="dashboard-unit-test-analytics-section-title">Difficulty-based performance</h4>
          <div
            className="dashboard-pipeline-essential-card dashboard-unit-test-difficulty-performance-card"
            {...cardCapture(reportCapture, 'UT — Difficulty performance')}
          >
            <h5>Difficulty performance</h5>
            <p className="dashboard-pipeline-essential-sub">
              Compare full-reading accuracy and average confidence by difficulty tier. A large gap may indicate
              overconfidence on harder meters.
            </p>
            {hasDifficultyChart ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={difficultyPerformanceData}
                    margin={{ top: 16, right: 12, left: 8, bottom: 36 }}
                    barCategoryGap="18%"
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                    <XAxis
                      dataKey="tier"
                      interval={0}
                      height={52}
                      tick={(props) => (
                        <DifficultyAxisTick {...props} rows={difficultyPerformanceData} />
                      )}
                    />
                    <YAxis domain={difficultyYDomain} tickFormatter={(v) => `${v}%`} width={44} />
                    <Tooltip content={<DifficultyPerformanceTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="accuracy"
                      name="Accuracy"
                      fill={ACCURACY_FILL}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="confidence"
                      name="Avg confidence"
                      fill={CONFIDENCE_FILL}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
                <div className="dashboard-unit-test-difficulty-table-wrap">
                  <table className="dashboard-unit-test-difficulty-table">
                    <thead>
                      <tr>
                        <th scope="col">Difficulty</th>
                        <th scope="col">Accuracy</th>
                        <th scope="col">Avg confidence</th>
                        <th scope="col">Images tested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {difficultyPerformanceData.map((row) => (
                        <tr key={row.tier}>
                          <th scope="row">{row.tier}</th>
                          <td>{pctDisplay(row.accuracy)}</td>
                          <td>{pctDisplay(row.confidence)}</td>
                          <td>{row.imageCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">No difficulty metrics in these results.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="dashboard-unit-test-analytics-section">
        <h4 className="dashboard-unit-test-analytics-section-title">Detailed analysis</h4>
        <div className="dashboard-unit-test-analytics-grid dashboard-unit-test-analytics-grid--1">
          <UnitTestConfusionHeatmap
            perImageRows={detail.perImageRows}
            imageSource={confusionImageSource}
            workType={workType}
          />

          <div className="dashboard-pipeline-essential-card" {...cardCapture(reportCapture, 'UT — Confidence distribution')}>
            <h5>Confidence distribution</h5>
            <p className="dashboard-pipeline-essential-sub">
              Distribution of dial-level model confidence scores.
            </p>
            {histogram.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={histogram} margin={{ top: 12, right: 8, left: 8, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} angle={-28} textAnchor="end" height={48} />
                  <YAxis allowDecimals={false} width={36} label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={CONFIDENCE_FILL} radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">
                No confidence data in these results.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default DashboardUnitTestCsvCharts;
