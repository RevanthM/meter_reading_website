import { useMemo, type FC } from 'react';
import { ResponsiveContainer, PieChart, Pie, Tooltip } from 'recharts';
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
  /** 0 = aggregate (e.g. average across D1–D4). */
  dial: number;
  pct: number | null;
  title?: string;
  metricLabel: 'accuracy' | 'confidence';
  fill: string;
  compact?: boolean;
  /** e.g. "9/12 on incorrect captures" */
  countNote?: string | null;
  /** e.g. "238/247 correct per capture" */
  detailNote?: string | null;
};

const DialPctDonut: FC<Props> = ({
  dial,
  pct,
  title,
  metricLabel,
  fill,
  compact = false,
  countNote = null,
  detailNote = null,
}) => {
  const dialTitle = title ?? (dial === 0 ? 'All dials (avg)' : `Dial ${dial}`);
  const slices = useMemo(() => {
    const raw = pctDonutData(pct);
    return raw.map((s) => ({ ...s, fill: s.fill === 'active' ? fill : s.fill }));
  }, [pct, fill]);

  const height = compact ? 100 : 140;
  const tooltipText = useMemo(() => {
    if (metricLabel === 'accuracy' && countNote) return countNote;
    if (pct != null && Number.isFinite(pct)) {
      return `${formatPortalAccuracyConfidencePct(pct)} ${metricLabel}`;
    }
    return detailNote;
  }, [pct, metricLabel, countNote, detailNote]);

  return (
    <div
      className={`analytics-donut${compact ? ' analytics-donut--compact' : ''}`}
      title={tooltipText ?? undefined}
    >
      <p className="analytics-donut__title">{dialTitle}</p>
      {slices.length > 0 && pct != null ? (
        <>
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
                  stroke="none"
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ active }) =>
                    active && tooltipText ? (
                      <div style={tooltipStyle} className="analytics-donut__tooltip">
                        <p className="analytics-donut__tooltip-line">{tooltipText}</p>
                      </div>
                    ) : null
                  }
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="analytics-donut__center" aria-hidden>
              <span className="analytics-donut__pct">{formatPortalAccuracyConfidencePct(pct)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="analytics-donut__empty">—</p>
      )}
    </div>
  );
};

export default DialPctDonut;
