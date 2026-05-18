import { useMemo, useState, type FC } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
  Cell,
  LabelList,
} from 'recharts';
import type { PipelineIterationRecord } from '../services/api';
import { FACTORY_PRODUCT_LINE_CHART, buildPipelineIterationChartPoints } from '../constants/pipelineChartTheme';

const TARGET_PCT = 80;

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

type Props = {
  rows: PipelineIterationRecord[];
};

export type ImprovementMetricView = 'confidence' | 'accuracy' | 'both';

function pctLabel(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(0)}%` : '';
}

const METRIC_VIEW_OPTIONS: { id: ImprovementMetricView; label: string }[] = [
  { id: 'confidence', label: 'Confidence' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'both', label: 'Both' },
];

/** Short x-axis: "Sempra #1" */
function shortChartLabel(pipeline: string, iterationNumber: number): string {
  const name = pipeline.replace(/\s*\(p\d\)\s*$/i, '').trim();
  const short = name.length > 14 ? `${name.slice(0, 12)}…` : name;
  return `${short} #${iterationNumber}`;
}

const DashboardIterationTrendChart: FC<Props> = ({ rows }) => {
  const [metricView, setMetricView] = useState<ImprovementMetricView>('both');

  const chartData = useMemo(() => {
    return buildPipelineIterationChartPoints(rows).map((p) => ({
      id: p.id,
      line: p.line,
      pipeline: p.pipeline,
      iterationNumber: p.iterationNumber,
      chartLabel: shortChartLabel(p.pipeline, p.iterationNumber),
      confidencePct: p.confidencePct,
      accuracyPct: p.accuracyPct,
    }));
  }, [rows]);

  if (!chartData.length) {
    return (
      <div className="chart-card dashboard-iteration-trend-card">
        <div className="chart-empty chart-empty--tight">
          Add pipeline iterations with eval metrics to see trends.
        </div>
      </div>
    );
  }

  const showConfidence = metricView === 'confidence' || metricView === 'both';
  const showAccuracy = metricView === 'accuracy' || metricView === 'both';
  const showGoalLine = metricView !== 'confidence';
  const singleMetric = metricView !== 'both';

  return (
    <div className="chart-card dashboard-iteration-trend-card">
      <div className="dashboard-iteration-trend-head">
        <h3 className="dashboard-iteration-trend-title">Improvement by product line</h3>
        <div className="dashboard-improvement-metric-toggle" role="group" aria-label="Chart metric">
          {METRIC_VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`dashboard-improvement-metric-btn${
                metricView === opt.id ? ' dashboard-improvement-metric-btn--active' : ''
              }`}
              onClick={() => setMetricView(opt.id)}
              aria-pressed={metricView === opt.id}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="pipeline-iterations-charts-hint">
        Six iterations (two per pipeline). Colors: <strong>blue</strong> Sempra · <strong>violet</strong> Anica ·{' '}
        <strong>green</strong> combined.
        {metricView === 'both'
          ? ' Each row shows confidence (lighter) and accuracy (solid).'
          : metricView === 'confidence'
            ? ' Showing simulator confidence (avg dials) for all six rows.'
            : ' Showing read accuracy (FT → UT → exact) for all six rows.'}
        {' '}
        Iteration #1 accuracy may be estimated where UT/FT were not measured yet.
      </p>

      <div
        className="dashboard-pipeline-improvement-legend dashboard-pipeline-improvement-legend--six"
        aria-label="Chart series legend"
      >
        {chartData.map((d) => {
          const theme = FACTORY_PRODUCT_LINE_CHART[d.line];
          const valueParts: string[] = [];
          if ((metricView === 'confidence' || metricView === 'both') && d.confidencePct != null) {
            valueParts.push(`${d.confidencePct.toFixed(0)}% conf`);
          }
          if ((metricView === 'accuracy' || metricView === 'both') && d.accuracyPct != null) {
            valueParts.push(`${d.accuracyPct.toFixed(0)}% acc`);
          }
          return (
            <span
              key={d.id}
              className="dashboard-pipeline-improvement-chip"
              style={{
                borderColor: theme.stroke,
                background: `color-mix(in srgb, ${theme.fill} 12%, transparent)`,
                color: theme.stroke,
              }}
            >
              <span className="dashboard-pipeline-improvement-chip-dot" style={{ background: theme.fill }} />
              <span className="dashboard-pipeline-improvement-chip-label">{d.chartLabel}</span>
              {valueParts.length ? (
                <span className="dashboard-pipeline-improvement-chip-delta">{valueParts.join(' · ')}</span>
              ) : null}
            </span>
          );
        })}
      </div>

      <div className="dashboard-iteration-trend-inner dashboard-iteration-trend-inner--six-rows">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart
            data={chartData}
            margin={{ top: 22, right: 12, left: 4, bottom: singleMetric ? 52 : 48 }}
            barCategoryGap={singleMetric ? '12%' : '18%'}
            barGap={metricView === 'both' ? 2 : 0}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
            <XAxis
              dataKey="chartLabel"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-28}
              textAnchor="end"
              height={56}
            />
            <YAxis domain={[55, 100]} tickFormatter={(v) => `${v}%`} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload as { pipeline?: string; iterationNumber?: number } | undefined;
                if (p?.pipeline != null && p.iterationNumber != null) {
                  return `${p.pipeline} · iteration #${p.iterationNumber}`;
                }
                return _label;
              }}
              formatter={(value: number, name: string) => [
                value != null && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—',
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {showGoalLine ? (
              <ReferenceLine
                y={TARGET_PCT}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{ value: '80% goal', fontSize: 10, position: 'insideTopRight' }}
              />
            ) : null}
            {showConfidence ? (
              <Bar
                dataKey="confidencePct"
                name="Sim confidence"
                radius={[4, 4, 0, 0]}
                maxBarSize={singleMetric ? 52 : 32}
              >
                {chartData.map((entry) => {
                  const theme = FACTORY_PRODUCT_LINE_CHART[entry.line];
                  return (
                    <Cell
                      key={`${entry.id}-conf`}
                      fill={singleMetric ? theme.fillMuted : theme.fillMuted}
                      stroke={theme.stroke}
                      strokeWidth={1}
                    />
                  );
                })}
                <LabelList dataKey="confidencePct" position="top" fontSize={10} fontWeight={600} formatter={pctLabel} />
              </Bar>
            ) : null}
            {showAccuracy ? (
              <Bar
                dataKey="accuracyPct"
                name="Read accuracy"
                radius={[4, 4, 0, 0]}
                maxBarSize={singleMetric ? 52 : 32}
              >
                {chartData.map((entry) => {
                  const theme = FACTORY_PRODUCT_LINE_CHART[entry.line];
                  return (
                    <Cell
                      key={`${entry.id}-acc`}
                      fill={theme.fill}
                      stroke={theme.stroke}
                      strokeWidth={1}
                    />
                  );
                })}
                <LabelList dataKey="accuracyPct" position="top" fontSize={10} fontWeight={600} formatter={pctLabel} />
              </Bar>
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DashboardIterationTrendChart;
