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
import { effectiveIterationAccuracyPercent } from '../utils/pipelineIterationStats';
import { normalizePipelineIterationPrimaryStatus } from '../constants/pipelineIterationRegistry';

/** Bar + pie slice colors: completed green, in process yellow, planning blue. */
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

function shortLabel(r: PipelineIterationRecord): string {
  const p = (r.pipeline || '—').trim();
  const short = p.length > 16 ? `${p.slice(0, 14)}…` : p;
  return `${short} · #${r.iterationNumber}`;
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
};

const PipelineIterationsCharts: FC<Props> = ({ rows, onIterationClick }) => {
  const statusData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const s = normalizePipelineIterationPrimaryStatus(r.currentStatus) || '(not set)';
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  }, [rows]);

  const accuracyData = useMemo(() => {
    return rows
      .map((r) => {
        const v = effectiveIterationAccuracyPercent(r);
        if (v == null || !Number.isFinite(v)) return null;
        return { label: shortLabel(r), pct: Math.min(100, Math.max(0, v)) };
      })
      .filter(Boolean) as { label: string; pct: number }[];
  }, [rows]);

  const reviewData = useMemo(() => {
    return rows
      .map((r) => {
        const v = r.manualMetrics?.manualReviewRatePct;
        if (v == null || !Number.isFinite(v)) return null;
        return { label: shortLabel(r), review: Math.min(100, Math.max(0, v)) };
      })
      .filter(Boolean) as { label: string; review: number }[];
  }, [rows]);

  const imageData = useMemo(() => {
    return rows
      .map((r) => {
        const n = r.imageCount ?? r.portalStats?.totalImages ?? null;
        if (n == null || !Number.isFinite(n)) return null;
        const statusNorm = normalizePipelineIterationPrimaryStatus(r.currentStatus) || '(not set)';
        return {
          id: r.id,
          label: shortLabel(r),
          images: n,
          statusNorm,
          statusLabel: STATUS_VISUAL[statusNorm]?.label ?? statusNorm,
        };
      })
      .filter(Boolean) as {
      id: string;
      label: string;
      images: number;
      statusNorm: string;
      statusLabel: string;
    }[];
  }, [rows]);

  if (!rows.length) return null;

  return (
    <section className="pipeline-iterations-charts" aria-labelledby="pipeline-charts-heading">
      <h2 id="pipeline-charts-heading">Overview</h2>
      <p className="pipeline-iterations-charts-hint">
        Accuracy bars use the best available value per row: manual exact reading %, then UT read accuracy, then portal
        simulator / all-queue correct %.
      </p>
      <div className="pipeline-iterations-charts-grid">
        <div className="pipeline-iterations-charts-top-row">
          <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--pie">
            <h3>Iterations by status</h3>
            {statusData.length > 0 ? (
              <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--pie">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={82}
                    >
                      {statusData.map((entry, i) => (
                        <Cell key={i} fill={fillForNormalizedStatus(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v} row(s)`, 'Count']} contentStyle={tooltipStyle} />
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
            <p className="pipeline-iterations-chart-sub">
              Colors: completed (green), in process (yellow), planning (blue). Click a bar to edit that iteration.
            </p>
            {imageData.length > 0 ? (
              <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--image-bars">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={imageData} margin={{ left: 4, right: 8, top: 28, bottom: 56 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                    <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={58} tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, _name: string, item: { payload?: { statusLabel?: string } }) => {
                        const sl = item?.payload?.statusLabel;
                        return [`${value} images${sl ? ` · ${sl}` : ''}`, 'Iteration'];
                      }}
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
                        formatter={(v: number | string) => (typeof v === 'number' ? String(v) : v)}
                      />
                      {imageData.map((d) => (
                        <Cell key={d.id} fill={fillForNormalizedStatus(d.statusNorm)} />
                      ))}
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

        {accuracyData.length > 0 ? (
          <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--wide">
            <h3>Effective accuracy % (manual → portal fallback)</h3>
            <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--tall">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={accuracyData} layout="vertical" margin={{ left: 8, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Accuracy']} contentStyle={tooltipStyle} />
                  <Bar dataKey="pct" fill="var(--accent-amber, #2563eb)" name="Accuracy %" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="pct"
                      position="right"
                      fill="var(--text-primary, #0f172a)"
                      fontSize={11}
                      fontWeight={600}
                      formatter={(v: number | string) =>
                        typeof v === 'number' ? `${v.toFixed(1)}%` : String(v)
                      }
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}

        {reviewData.length > 0 ? (
          <div className="pipeline-iterations-chart-card pipeline-iterations-chart-card--wide">
            <h3>Manual review rate %</h3>
            <div className="pipeline-iterations-chart-inner pipeline-iterations-chart-inner--tall">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={reviewData} layout="vertical" margin={{ left: 8, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Review rate']} contentStyle={tooltipStyle} />
                  <Bar dataKey="review" fill="var(--status-analyzed, #ca8a04)" name="Review %" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="review"
                      position="right"
                      fill="var(--text-primary, #0f172a)"
                      fontSize={11}
                      fontWeight={600}
                      formatter={(v: number | string) =>
                        typeof v === 'number' ? `${v.toFixed(1)}%` : String(v)
                      }
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}

      </div>
    </section>
  );
};

export default PipelineIterationsCharts;
