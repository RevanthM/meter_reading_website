import { useMemo, type FC } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

const REMAINDER_FILL = '#e2e8f0';

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated, #fff)',
  border: '1px solid var(--border-color, #e2e8f0)',
  borderRadius: 8,
  fontSize: 12,
};

function pctDonutData(pct: number | null): { name: string; value: number; fill: string }[] {
  if (pct == null || !Number.isFinite(pct)) return [];
  const clamped = Math.min(100, Math.max(0, pct));
  const remainder = Math.max(0, 100 - clamped);
  return [
    { name: 'Score', value: clamped, fill: 'active' },
    { name: 'Remainder', value: remainder, fill: REMAINDER_FILL },
  ];
}

type Props = {
  dial: number;
  pct: number | null;
  metricLabel: 'accuracy' | 'confidence';
  fill: string;
  compact?: boolean;
};

const DialPctDonut: FC<Props> = ({ dial, pct, metricLabel, fill, compact = false }) => {
  const slices = useMemo(() => {
    const raw = pctDonutData(pct);
    return raw.map((s) => ({ ...s, fill: s.fill === 'active' ? fill : s.fill }));
  }, [pct, fill]);

  const height = compact ? 100 : 140;

  return (
    <div className={`analytics-donut${compact ? ' analytics-donut--compact' : ''}`}>
      <p className="analytics-donut__title">Dial {dial}</p>
      {slices.length > 0 && pct != null ? (
        <div className="analytics-donut__wrap">
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={1}
                isAnimationActive={false}
              >
                {slices.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, name: string) =>
                  name === 'Score' ? [formatPortalAccuracyConfidencePct(v), metricLabel] : null
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="analytics-donut__center" aria-hidden>
            <span className="analytics-donut__pct">{formatPortalAccuracyConfidencePct(pct)}</span>
          </div>
        </div>
      ) : (
        <p className="analytics-donut__empty">—</p>
      )}
    </div>
  );
};

export default DialPctDonut;
