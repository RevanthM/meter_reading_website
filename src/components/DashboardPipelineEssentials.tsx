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
  Cell,
  LabelList,
} from 'recharts';
import type { PipelineIterationRecord } from '../services/api';
import { inferProductLineForRow, type FactoryProductLine } from '../constants/factoryStages';
import {
  buildPipelineIterationChartPoints,
  chartThemeForLine,
  filterEvalChartRows,
  filterRegistryOverviewRows,
  FACTORY_PRODUCT_LINE_CHART,
  perDialMetricsFromRow,
  type ChartPipelineFilter,
} from '../constants/pipelineChartTheme';

const DIAL_OPTIONS = [1, 2, 3, 4] as const;
type DialOption = (typeof DIAL_OPTIONS)[number];

function iterationShortLabel(
  line: Exclude<FactoryProductLine, 'unknown'>,
  iterationNumber: number,
): string {
  return `${line} #${iterationNumber}`;
}

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

function pctLabel(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(0)}%` : '';
}

type Props = {
  rows: PipelineIterationRecord[];
  pipelineFilter?: ChartPipelineFilter;
};

const DashboardPipelineEssentials: FC<Props> = ({ rows, pipelineFilter = 'all' }) => {
  const [selectedDial, setSelectedDial] = useState<DialOption>(1);
  const metricPoints = useMemo(() => buildPipelineIterationChartPoints(rows), [rows]);
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);
  const overviewRows = useMemo(() => filterRegistryOverviewRows(rows), [rows]);

  const confidenceData = useMemo(
    () =>
      metricPoints
        .filter((p) => p.simConfidencePct != null || p.readConfidencePct != null)
        .map((p) => ({
          id: p.id,
          label: iterationShortLabel(p.line, p.iterationNumber),
          fullLabel: p.xLabel,
          line: p.line,
          sim: p.simConfidencePct,
          app: p.readConfidencePct,
        })),
    [metricPoints],
  );

  const accuracyData = useMemo(
    () =>
      metricPoints
        .filter((p) => p.simAccuracyPct != null || p.readAccuracyPct != null)
        .map((p) => ({
          id: p.id,
          label: iterationShortLabel(p.line, p.iterationNumber),
          fullLabel: p.xLabel,
          line: p.line,
          sim: p.simAccuracyPct,
          app: p.readAccuracyPct,
        })),
    [metricPoints],
  );

  const perDialByIteration = useMemo(() => {
    const conf: Array<{
      id: string;
      label: string;
      fullLabel: string;
      line: (typeof metricPoints)[0]['line'];
      sim: number | null;
      app: number | null;
    }> = [];
    const acc: typeof conf = [];

    for (const r of evalRows) {
      const line = inferProductLineForRow(r);
      if (line === 'unknown') continue;
      const d = perDialMetricsFromRow(r)[selectedDial - 1];
      if (!d) continue;
      const label = iterationShortLabel(line, r.iterationNumber);
      const fullLabel = `${r.pipeline.trim()} · #${r.iterationNumber} · Dial ${selectedDial}`;
      if (d.simConf != null || d.appConf != null) {
        conf.push({ id: r.id, label, fullLabel, line, sim: d.simConf, app: d.appConf });
      }
      if (d.simAcc != null || d.appAcc != null) {
        acc.push({ id: r.id, label, fullLabel, line, sim: d.simAcc, app: d.appAcc });
      }
    }
    return { conf, acc };
  }, [evalRows, selectedDial]);

  const imageData = useMemo(() => {
    return overviewRows
      .map((r) => {
        const n = r.imageCount ?? r.portalStats?.totalImages ?? null;
        if (n == null || !Number.isFinite(n)) return null;
        const line = inferProductLineForRow(r);
        if (line === 'unknown') return null;
        return {
          id: r.id,
          shortLabel: `${line} #${r.iterationNumber}`,
          fullLabel: `${r.pipeline.trim()} · #${r.iterationNumber}`,
          line,
          images: n,
        };
      })
      .filter(Boolean) as {
      id: string;
      shortLabel: string;
      fullLabel: string;
      line: typeof metricPoints[0]['line'];
      images: number;
    }[];
  }, [overviewRows]);

  const filterLabel =
    pipelineFilter !== 'all' ? FACTORY_PRODUCT_LINE_CHART[pipelineFilter].label : null;

  return (
    <div className="dashboard-pipeline-essentials">
      <p className="dashboard-pipeline-essentials-lead">
        Per iteration from the registry — later runs should show more images and higher sim/app scores.
        {filterLabel ? ` Showing ${filterLabel}.` : ''}{' '}
        <span className="dashboard-pipeline-essentials-legend-inline">
          <strong>Blue</strong> Sempra · <strong>Violet</strong> Anica · <strong>Green</strong> combined
        </span>
      </p>

      {imageData.length > 0 ? (
        <div className="dashboard-pipeline-images-compact">
          <span className="dashboard-pipeline-images-compact-label">Training images</span>
          <div className="dashboard-pipeline-images-compact-chart">
            <ResponsiveContainer width="100%" height={imageData.length > 4 ? 112 : 96}>
              <BarChart
                data={imageData}
                layout="vertical"
                margin={{ left: 4, right: 36, top: 4, bottom: 4 }}
              >
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                <YAxis type="category" dataKey="shortLabel" width={52} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_l, payload) => {
                    const p = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                    return p?.fullLabel ?? _l;
                  }}
                  formatter={(v: number) => [`${v.toLocaleString()} images`, 'Training set']}
                />
                <Bar dataKey="images" radius={[0, 4, 4, 0]} maxBarSize={14}>
                  <LabelList dataKey="images" position="right" fontSize={10} fontWeight={600} />
                  {imageData.map((d) => {
                    const theme = chartThemeForLine(d.line);
                    return <Cell key={d.id} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="dashboard-pipeline-essential-card">
        <h3>Confidence — simulator vs app</h3>
        <p className="dashboard-pipeline-essential-sub">By iteration · lighter = simulator · solid = app.</p>
        {confidenceData.length > 0 ? (
          <div className="dashboard-pipeline-essential-chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={confidenceData} margin={{ top: 12, right: 8, left: 4, bottom: 56 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={58} tick={{ fontSize: 10 }} />
                <YAxis domain={[55, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_l, payload) => {
                    const p = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                    return p?.fullLabel ?? _l;
                  }}
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sim" name="Sim confidence" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  <LabelList dataKey="sim" position="top" fontSize={9} formatter={pctLabel} />
                  {confidenceData.map((d) => {
                    const theme = chartThemeForLine(d.line);
                    return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                  })}
                </Bar>
                <Bar dataKey="app" name="App confidence" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  <LabelList dataKey="app" position="top" fontSize={9} formatter={pctLabel} />
                  {confidenceData.map((d) => {
                    const theme = chartThemeForLine(d.line);
                    return <Cell key={`${d.id}-app`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="pipeline-iterations-chart-card-placeholder">Add simulator and app dial confidence %.</p>
        )}
      </div>

      <div className="dashboard-pipeline-essential-card">
        <h3>Accuracy — simulator vs app</h3>
        <p className="dashboard-pipeline-essential-sub">By iteration · lighter = simulator · solid = app.</p>
        {accuracyData.length > 0 ? (
          <div className="dashboard-pipeline-essential-chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={accuracyData} margin={{ top: 12, right: 8, left: 4, bottom: 56 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={58} tick={{ fontSize: 10 }} />
                <YAxis domain={[55, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_l, payload) => {
                    const p = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                    return p?.fullLabel ?? _l;
                  }}
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sim" name="Sim accuracy" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  <LabelList dataKey="sim" position="top" fontSize={9} formatter={pctLabel} />
                  {accuracyData.map((d) => {
                    const theme = chartThemeForLine(d.line);
                    return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                  })}
                </Bar>
                <Bar dataKey="app" name="App accuracy" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  <LabelList dataKey="app" position="top" fontSize={9} formatter={pctLabel} />
                  {accuracyData.map((d) => {
                    const theme = chartThemeForLine(d.line);
                    return <Cell key={`${d.id}-app`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="pipeline-iterations-chart-card-placeholder">Add simulator and app dial accuracy %.</p>
        )}
      </div>

      <div className="dashboard-pipeline-essential-card dashboard-pipeline-essential-card--per-dial-iter">
        <div className="dashboard-per-dial-head">
          <div>
            <h3>Per dial — improvement by iteration</h3>
            <p className="dashboard-pipeline-essential-sub">
              Sim/app dial columns, or dial UT % (sim) and FT % (app) from the registry · read left to right
              across iterations.
            </p>
          </div>
          <div className="dashboard-confusion-dial-toggle" role="group" aria-label="Meter dial position">
            {DIAL_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`dashboard-improvement-metric-btn${
                  selectedDial === d ? ' dashboard-improvement-metric-btn--active' : ''
                }`}
                onClick={() => setSelectedDial(d)}
                aria-pressed={selectedDial === d}
              >
                Dial {d}
              </button>
            ))}
          </div>
        </div>
        <div className="dashboard-per-dial-by-iter-grid">
          <div>
            <h4>Dial {selectedDial} confidence</h4>
            {perDialByIteration.conf.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={perDialByIteration.conf} margin={{ top: 12, right: 8, left: 4, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={50} tick={{ fontSize: 10 }} />
                  <YAxis domain={[55, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_l, payload) => {
                      const p = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                      return p?.fullLabel ?? _l;
                    }}
                    formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="sim" name="Sim" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    <LabelList dataKey="sim" position="top" fontSize={9} formatter={pctLabel} />
                    {perDialByIteration.conf.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                  <Bar dataKey="app" name="App" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    <LabelList dataKey="app" position="top" fontSize={9} formatter={pctLabel} />
                    {perDialByIteration.conf.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-app`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">
                Add sim/app dial {selectedDial} confidence on iteration rows.
              </p>
            )}
          </div>
          <div>
            <h4>Dial {selectedDial} accuracy</h4>
            {perDialByIteration.acc.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={perDialByIteration.acc} margin={{ top: 12, right: 8, left: 4, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" vertical={false} />
                  <XAxis dataKey="label" angle={-22} textAnchor="end" interval={0} height={50} tick={{ fontSize: 10 }} />
                  <YAxis domain={[55, 100]} tickFormatter={(v) => `${v}%`} width={36} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_l, payload) => {
                      const p = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                      return p?.fullLabel ?? _l;
                    }}
                    formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="sim" name="Sim" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    <LabelList dataKey="sim" position="top" fontSize={9} formatter={pctLabel} />
                    {perDialByIteration.acc.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-sim`} fill={theme.fillMuted} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                  <Bar dataKey="app" name="App" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    <LabelList dataKey="app" position="top" fontSize={9} formatter={pctLabel} />
                    {perDialByIteration.acc.map((d) => {
                      const theme = chartThemeForLine(d.line);
                      return <Cell key={`${d.id}-app`} fill={theme.fill} stroke={theme.stroke} strokeWidth={1} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pipeline-iterations-chart-card-placeholder">
                Add sim/app dial {selectedDial} accuracy on iteration rows.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPipelineEssentials;
