import { useMemo, type FC } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LabelList,
} from 'recharts';
import type { PipelineIterationRecord } from '../services/api';
import { normalizePipelineIterationPrimaryStatus } from '../constants/pipelineIterationRegistry';
import {
  buildPipelineIterationChartPoints,
  blendHexColors,
  chartThemeForLine,
  FACTORY_PRODUCT_LINE_CHART,
  filterEvalChartRows,
  filterRegistryOverviewRows,
  manualReviewRatePct,
  type ChartPipelineFilter,
} from '../constants/pipelineChartTheme';
import { inferProductLineForRow } from '../constants/factoryStages';
import { isEstimatedEvalMetrics } from '../utils/iterationMetricsEnrichment';

const STATUS_VISUAL: Record<string, { fill: string; label: string }> = {
  Completed: { fill: '#16a34a', label: 'Completed' },
  'In Process': { fill: '#eab308', label: 'In process' },
  Planning: { fill: '#2563eb', label: 'Planning' },
  Cancelled: { fill: '#64748b', label: 'Cancelled' },
  '(not set)': { fill: '#94a3b8', label: 'Not set' },
};

function fillForNormalizedStatus(statusNorm: string): string {
  return STATUS_VISUAL[statusNorm]?.fill ?? '#64748b';
}

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

type Props = {
  rows: PipelineIterationRecord[];
  /** Opens the iteration editor when a bar in the image chart is clicked. */
  onIterationClick?: (iterationId: string) => void;
  /** Hide page-level heading when embedded on admin dashboard. */
  embedded?: boolean;
  /** Un-enriched registry rows (for estimated-metric tooltips). */
  sourceRows?: PipelineIterationRecord[];
  /** Active pipeline filter label for empty-state copy. */
  pipelineFilter?: ChartPipelineFilter;
};

function pctLabel(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(0)}%` : '';
}

const PipelineIterationsCharts: FC<Props> = ({
  rows,
  onIterationClick,
  embedded = false,
  sourceRows,
  pipelineFilter = 'all',
}) => {
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);
  const overviewRows = useMemo(() => filterRegistryOverviewRows(rows), [rows]);
  const metricPoints = useMemo(() => buildPipelineIterationChartPoints(rows), [rows]);
  const rawForEstimate = sourceRows ?? rows;

  const statusData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of overviewRows) {
      const s = normalizePipelineIterationPrimaryStatus(r.currentStatus) || '(not set)';
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  }, [overviewRows]);

  const confidenceData = useMemo(
    () =>
      metricPoints
        .filter((p) => p.simConfidencePct != null || p.readConfidencePct != null)
        .map((p) => ({
          id: p.id,
          label: p.xLabel,
          line: p.line,
          sim: p.simConfidencePct,
          read: p.readConfidencePct,
        })),
    [metricPoints],
  );

  const accuracyData = useMemo(
    () =>
      metricPoints
        .filter((p) => p.simAccuracyPct != null || p.readAccuracyPct != null)
        .map((p) => ({
          id: p.id,
          label: p.xLabel,
          line: p.line,
          sim: p.simAccuracyPct,
          read: p.readAccuracyPct,
          estimated: (() => {
            const row = evalRows.find((r) => r.id === p.id);
            return row ? isEstimatedEvalMetrics(row, rawForEstimate) : false;
          })(),
        })),
    [metricPoints, evalRows, rawForEstimate],
  );

  const reviewData = useMemo(() => {
    return evalRows
      .map((r) => {
        const v = manualReviewRatePct(r);
        if (v == null) return null;
        const line = metricPoints.find((p) => p.id === r.id)?.line;
        if (!line) return null;
        return { id: r.id, label: `${r.pipeline.trim()} · #${r.iterationNumber}`, review: v, line };
      })
      .filter(Boolean) as { id: string; label: string; review: number; line: typeof metricPoints[0]['line'] }[];
  }, [evalRows, metricPoints]);

  const imageData = useMemo(() => {
    return overviewRows
      .map((r) => {
        const n = r.imageCount ?? r.portalStats?.totalImages ?? null;
        if (n == null || !Number.isFinite(n)) return null;
        const line = inferProductLineForRow(r);
        if (line === 'unknown') return null;
        return {
          id: r.id,
          label: `${r.pipeline.trim()} · #${r.iterationNumber}`,
          line,
          images: n,
        };
      })
      .filter(Boolean) as { id: string; label: string; line: typeof metricPoints[0]['line']; images: number }[];
  }, [overviewRows]);

  const filterHint =
    pipelineFilter === 'all'
      ? ''
      : ` Showing ${FACTORY_PRODUCT_LINE_CHART[pipelineFilter].label} only.`;

  if (!overviewRows.length && !evalRows.length) {
    return (
      <div className={`pipeline-iterations-charts${embedded ? ' pipeline-iterations-charts--embedded' : ''}`}>
        <p className="pipeline-iterations-charts-empty">
          No pipeline iterations match this filter.{filterHint || ' Add rows in the registry.'}
        </p>
      </div>
    );
  }

  return (
    <section
      className={`pipeline-iterations-charts${embedded ? ' pipeline-iterations-charts--embedded' : ''}`}
      aria-labelledby={embedded ? undefined : 'pipeline-charts-heading'}
    >
      {!embedded ? <h2 id="pipeline-charts-heading">Overview</h2> : null}
      <p className="pipeline-iterations-charts-hint">
        Data from the pipeline iterations registry (manual metrics, with portal stats when manual fields are empty).
        Colors match Model factory: <strong>blue</strong> Sempra, <strong>violet</strong> Anica, <strong>green</strong>{' '}
        combined.{filterHint} Charts compare simulator vs read (app) metrics from manual dial fields, with portal fallbacks.
      </p>
      <div className="pipeline-iterations-charts-grid">
        <div className="pipeline-iterations-charts-top-row">
          <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--pie">
            <h3>Registry iterations by status</h3>
            <p className="pipeline-iterations-chart-sub">
              Six completed eval runs plus combined #3 in training when present.
            </p>
            {statusData.length > 0 ? (
              <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--pie">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={0} outerRadius={82}>
                      {statusData.map((entry, i) => (
                        <Cell key={i} fill={fillForNormalizedStatus(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [`${v} iteration(s)`, STATUS_VISUAL[name]?.label ?? name]}
                      contentStyle={tooltipStyle}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">Set a status on iterations to see the pie chart.</p>
            )}
          </div>

          <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--images">
            <h3>Training / registry image count</h3>
            <p className="pipeline-iterations-chart-sub">Bar color = pipeline (same as Model factory). Click a bar to edit.</p>
            {imageData.length > 0 ? (
              <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--image-bars">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={imageData} margin={{ left: 4, right: 8, top: 28, bottom: 56 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                    <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={58} tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [`${value} images`, 'Count']}
                    />
                    <Bar
                      dataKey="images"
                      name="Images"
                      radius={[4, 4, 0, 0]}
                      cursor={onIterationClick ? 'pointer' : 'default'}
                      onClick={
                        onIterationClick
                          ? (data: { id?: string }) => {
                              if (data?.id) onIterationClick(data.id);
                            }
                          : undefined
                      }
                    >
                      <LabelList
                        dataKey="images"
                        position="top"
                        fill="var(--text-primary, #0f172a)"
                        fontSize={11}
                        fontWeight={600}
                      />
                      {imageData.map((d) => {
                        const theme = chartThemeForLine(d.line);
                        return <Cell key={d.id} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">
                Add a manual image count or load portal stats for an app version to see bars here.
              </p>
            )}
          </div>
        </div>

        <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--wide">
          <h3>Simulator vs app confidence %</h3>
          <p className="pipeline-iterations-chart-sub">Lighter bar = simulator dials · solid = on-device app dials.</p>
          {confidenceData.length > 0 ? (
            <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--tall">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={confidenceData} layout="vertical" margin={{ left: 8, right: 56, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis type="number" domain={[55, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sim" name="Sim confidence" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="sim" position="right" fontSize={10} fontWeight={600} formatter={pctLabel} />
                    {confidenceData.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                  <Bar dataKey="read" name="App confidence" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="read" position="right" fontSize={10} fontWeight={600} formatter={pctLabel} />
                    {confidenceData.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-read`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="pipeline-iterations-chart-card-placeholder">
              Add simulator and app dial confidence, or app bbox/keypoint confidence in the registry.
            </p>
          )}
        </div>

        <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--wide">
          <h3>Simulator vs app accuracy %</h3>
          <p className="pipeline-iterations-chart-sub">
            Lighter bar = simulator / UT · solid = on-device app. * = UT/FT estimated from a later iteration.
          </p>
          {accuracyData.length > 0 ? (
            <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--tall">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={accuracyData} layout="vertical" margin={{ left: 8, right: 56, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis type="number" domain={[55, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, name: string, item: { payload?: { estimated?: boolean } }) => [
                      `${v.toFixed(1)}%${item?.payload?.estimated && name === 'Read accuracy' ? ' (estimated)' : ''}`,
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sim" name="Sim accuracy" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="sim" position="right" fontSize={10} fontWeight={600} formatter={pctLabel} />
                    {accuracyData.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                  <Bar dataKey="read" name="App accuracy" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="read"
                      position="right"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(v: number | string, _n: string, item: { payload?: { estimated?: boolean } }) => {
                        const base = typeof v === 'number' ? `${v.toFixed(0)}%` : String(v);
                        return item?.payload?.estimated ? `${base}*` : base;
                      }}
                    />
                    {accuracyData.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-read`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="pipeline-iterations-chart-card-placeholder">
              Add simulator and app dial accuracy, or refresh portal UT/FT stats for an app version.
            </p>
          )}
        </div>

        <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--wide">
          <h3>Manual review rate %</h3>
          {reviewData.length > 0 ? (
            <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--tall">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={reviewData} layout="vertical" margin={{ left: 8, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Review rate']} contentStyle={tooltipStyle} />
                  <Bar dataKey="review" name="Review %" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="review" position="right" fontSize={11} fontWeight={600} formatter={pctLabel} />
                    {reviewData.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return (
                        <Cell
                          key={d.id}
                          fill={blendHexColors(theme.fill, theme.fillMuted, 0.55)}
                          stroke={theme.stroke}
                          strokeWidth={1}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="pipeline-iterations-chart-card-placeholder">
              Add manual review rate % or refresh portal stats (estimated from non-correct queue share).
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default PipelineIterationsCharts;
