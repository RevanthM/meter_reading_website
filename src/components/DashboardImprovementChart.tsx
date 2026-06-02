import { useMemo, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { ImprovementStoryBin } from '../utils/dashboardImprovementStats';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

type Props = {
  bins: ImprovementStoryBin[];
  /** App version / model id from bin → opens readings list filtered by `appVersion`. */
  onDrill: (appVersion: string) => void;
  loading?: boolean;
  /** Optional one-line from pipeline registry (latest eval). */
  registryHint?: string | null;
  /** Sessions in the chart time window (all readings, including versions not on axis). */
  windowSessionCount: number;
  /** Latest meaningful upload in window: confidence 0–100 (metadata / dials). */
  currentConfidencePct: number | null;
  /** Same row: model vs correction digit match when computable. */
  currentAccuracyPct: number | null;
};

const W = 640;
const H = 300;
const padL = 52;
const padR = 28;
const padT = 8;
const padB = 96;
const innerW = W - padL - padR;
const innerH = H - padT - padB;

const COL_CONF = '#3b82f6';
const COL_ACCURACY = '#0d9488';
/** Shared goal line */
const QUALITY_TARGET_PCT = 80;

const DashboardImprovementChart: FC<Props> = ({
  bins,
  onDrill,
  loading,
  registryHint,
  windowSessionCount,
  currentConfidencePct,
  currentAccuracyPct,
}) => {
  const active = useMemo(() => bins.filter((b) => b.totalSessions > 0), [bins]);

  const xAt = (i: number, n: number) => {
    if (n <= 1) return padL + innerW / 2;
    return padL + (i / (n - 1)) * innerW;
  };

  const yPct = (pct: number) => padT + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;

  const linePath = (getter: (b: ImprovementStoryBin) => number | null) => {
    const pts: string[] = [];
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      if (b.totalSessions === 0) continue;
      const v = getter(b);
      if (v == null) continue;
      pts.push(`${xAt(i, bins.length)},${yPct(v)}`);
    }
    return pts.length >= 2 ? `M ${pts.join(' L ')}` : '';
  };

  const pathConf = linePath((b) => b.avgConfidencePct);
  const pathAccuracy = linePath((b) => b.modelVsCorrectionPct);

  if (loading) {
    return (
      <div className="chart-card chart-card--hero dashboard-improvement-card">
        <div className="chart-empty chart-empty--tight">
          <Loader2 size={28} className="spin" />
          <span>Loading improvement view…</span>
        </div>
      </div>
    );
  }

  if (bins.length === 0 || active.length === 0) {
    return (
      <div className="chart-card chart-card--hero dashboard-improvement-card">
        <div className="chart-empty chart-empty--tight">No data in this range.</div>
      </div>
    );
  }

  const wHit = Math.max(24, Math.min(48, innerW / Math.max(bins.length, 1) - 2));
  const yTarget = yPct(QUALITY_TARGET_PCT);

  return (
    <div className="chart-card chart-card--hero dashboard-improvement-card">
      {registryHint ? (
        <div className="dashboard-improvement-head">
          <p className="dashboard-improvement-registry-hint" role="note">
            {registryHint}
          </p>
        </div>
      ) : null}

      <div className="dashboard-improvement-summary" aria-label="Window totals">
        <div>
          <span className="dashboard-improvement-summary-k">Sessions</span>
          <span className="dashboard-improvement-summary-v">{windowSessionCount.toLocaleString()}</span>
        </div>
        <div title="Pinned summary value (not computed from latest session in range).">
          <span className="dashboard-improvement-summary-k">Current confidence</span>
          <span className="dashboard-improvement-summary-v">
            {formatPortalAccuracyConfidencePct(currentConfidencePct)}
          </span>
        </div>
        <div title="Pinned summary value (not computed from latest session in range).">
          <span className="dashboard-improvement-summary-k">Current accuracy</span>
          <span className="dashboard-improvement-summary-v">
            {formatPortalAccuracyConfidencePct(currentAccuracyPct)}
          </span>
        </div>
      </div>

      <svg
        className="dashboard-improvement-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Confidence and accuracy by app version"
      >
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line
              x1={padL}
              y1={yPct(pct)}
              x2={W - padR}
              y2={yPct(pct)}
              stroke="var(--border-color, #e2e8f0)"
              strokeWidth={0.75}
              strokeDasharray={pct === 0 ? 'none' : '3 4'}
              opacity={0.85}
            />
            <text x={4} y={yPct(pct) + 4} fontSize={10} fill="var(--text-muted, #64748b)">
              {pct}%
            </text>
          </g>
        ))}

        <line
          x1={padL}
          y1={yTarget}
          x2={W - padR}
          y2={yTarget}
          stroke="var(--text-muted, #64748b)"
          strokeWidth={1.25}
          strokeDasharray="5 4"
          opacity={0.9}
        />
        <text
          x={padL + 4}
          y={yTarget - 6}
          fontSize={9}
          fill="var(--text-muted, #64748b)"
          fontWeight={600}
        >
          {QUALITY_TARGET_PCT}% target
        </text>

        {pathConf ? (
          <path
            d={pathConf}
            fill="none"
            stroke={COL_CONF}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {pathAccuracy ? (
          <path
            d={pathAccuracy}
            fill="none"
            stroke={COL_ACCURACY}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {bins.map((b, i) => {
          if (b.totalSessions === 0) return null;
          const cx = xAt(i, bins.length);
          const x0 = cx - wHit / 2;
          const tip = `${b.barLabel ?? b.date}: confidence ${formatPortalAccuracyConfidencePct(b.avgConfidencePct)} · accuracy ${formatPortalAccuracyConfidencePct(b.modelVsCorrectionPct)}`;
          return (
            <rect
              key={`hit-${b.date}`}
              x={x0}
              y={padT}
              width={wHit}
              height={innerH + 28}
              fill="transparent"
              className="dashboard-improvement-hit"
              onClick={() => onDrill(b.drillIso)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDrill(b.drillIso);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Open readings for app version ${b.barLabel ?? b.drillIso}`}
            >
              <title>{tip}</title>
            </rect>
          );
        })}

        {bins.map((b, i) => {
          if (b.totalSessions === 0) return null;
          const cx = xAt(i, bins.length);
          const raw = b.barLabel ?? b.date;
          const display = raw.length > 16 ? `${raw.slice(0, 14)}…` : raw;
          const ty = padT + innerH + 8;
          return (
            <text
              key={`xlab-${b.date}`}
              x={cx}
              y={ty}
              fontSize={9}
              textAnchor="middle"
              fill="var(--text-muted, #64748b)"
              transform={`rotate(-36 ${cx} ${ty})`}
            >
              <title>{raw}</title>
              {display}
            </text>
          );
        })}
      </svg>

      <ul className="dashboard-improvement-legend" aria-hidden>
        <li>
          <span className="dashboard-improvement-legend-line" style={{ borderColor: COL_CONF }} />
          Confidence
        </li>
        <li>
          <span className="dashboard-improvement-legend-line" style={{ borderColor: COL_ACCURACY }} />
          Accuracy
        </li>
        <li>
          <span
            className="dashboard-improvement-legend-line dashboard-improvement-legend-line--dashed"
            style={{ borderColor: 'var(--text-muted, #64748b)' }}
          />
          {QUALITY_TARGET_PCT}% target
        </li>
      </ul>
    </div>
  );
};

export default DashboardImprovementChart;
