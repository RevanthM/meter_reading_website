import { useMemo, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { ImprovementStoryBin } from '../utils/dashboardImprovementStats';

type Props = {
  bins: ImprovementStoryBin[];
  /** App version / model id from bin → opens readings list filtered by `appVersion`. */
  onDrill: (appVersion: string) => void;
  loading?: boolean;
  /** Optional one-line from pipeline registry (latest eval). */
  registryHint?: string | null;
};

const W = 640;
const H = 318;
const padL = 52;
const padR = 28;
const padT = 8;
const padB = 102;
const innerW = W - padL - padR;
const innerH = H - padT - padB;

const COL_CONF = '#3b82f6';
const COL_MODEL = '#0d9488';
const COL_BAR = 'color-mix(in srgb, var(--text-muted, #64748b) 35%, transparent)';
/** Shared goal line for confidence + reading-accuracy trends */
const QUALITY_TARGET_PCT = 80;

const DashboardImprovementChart: FC<Props> = ({
  bins,
  onDrill,
  loading,
  registryHint,
}) => {
  const active = useMemo(() => bins.filter((b) => b.totalSessions > 0), [bins]);

  const summary = useMemo(() => {
    let sessions = 0;
    let images = 0;
    let confW = 0;
    let confSessions = 0;
    let modelW = 0;
    let modelSessions = 0;
    let awaitR = 0;
    let funnel = 0;
    for (const b of bins) {
      sessions += b.totalSessions;
      images += b.totalImages;
      if (b.avgConfidencePct != null && b.confidenceSessions > 0) {
        confW += b.avgConfidencePct * b.confidenceSessions;
        confSessions += b.confidenceSessions;
      }
      if (b.modelVsCorrectionPct != null && b.modelVsCorrectionSessions > 0) {
        modelW += b.modelVsCorrectionPct * b.modelVsCorrectionSessions;
        modelSessions += b.modelVsCorrectionSessions;
      }
      awaitR += b.awaitingReview;
      funnel += b.inTrainingFunnel;
    }
    const confOverall = confSessions > 0 ? confW / confSessions : null;
    const modelOverall = modelSessions > 0 ? modelW / modelSessions : null;
    let blendSum = 0;
    let blendN = 0;
    if (confOverall != null) {
      blendSum += confOverall;
      blendN += 1;
    }
    if (modelOverall != null) {
      blendSum += modelOverall;
      blendN += 1;
    }
    const blendOverall = blendN > 0 ? blendSum / blendN : null;
    return {
      sessions,
      images,
      confOverall,
      modelOverall,
      blendOverall,
      awaitR,
      funnel,
      modelSessions,
      confSessions,
    };
  }, [bins]);

  const maxImages = useMemo(() => Math.max(...bins.map((b) => b.totalImages), 1), [bins]);

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
  const pathModel = linePath((b) => b.modelVsCorrectionPct);

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

  const barW = Math.min(28, innerW / Math.max(bins.length, 1) - 4);
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
          <span className="dashboard-improvement-summary-v">{summary.sessions.toLocaleString()}</span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">Images</span>
          <span className="dashboard-improvement-summary-v">{summary.images.toLocaleString()}</span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">Avg confidence</span>
          <span className="dashboard-improvement-summary-v">
            {summary.confOverall != null ? `${summary.confOverall.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">Reading match</span>
          <span
            className="dashboard-improvement-summary-v"
            title={`${summary.modelSessions.toLocaleString()} sessions with model + correction digits`}
          >
            {summary.modelOverall != null ? `${summary.modelOverall.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">Blend (window)</span>
          <span
            className="dashboard-improvement-summary-v"
            title="Average of avg confidence and reading match when each is available"
          >
            {summary.blendOverall != null ? `${summary.blendOverall.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">Awaiting review</span>
          <span className="dashboard-improvement-summary-v">{summary.awaitR.toLocaleString()}</span>
        </div>
        <div>
          <span className="dashboard-improvement-summary-k">In training path</span>
          <span className="dashboard-improvement-summary-v" title="Analyzed + labeled + in training dataset">
            {summary.funnel.toLocaleString()}
          </span>
        </div>
      </div>

      <svg
        className="dashboard-improvement-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Per app version: image volume, confidence and reading match"
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

        {bins.map((b, i) => {
          if (b.totalSessions === 0) return null;
          const cx = xAt(i, bins.length);
          const bh = (b.totalImages / maxImages) * (innerH * 0.35);
          const y0 = padT + innerH;
          const x0 = cx - barW / 2;
          return (
            <rect
              key={`bar-${b.date}`}
              x={x0}
              y={y0 - bh}
              width={barW}
              height={Math.max(bh, 1)}
              fill={COL_BAR}
              rx={2}
            >
              <title>{`${b.barLabel ?? b.date}: ${b.totalImages} images · ${b.totalSessions} sessions`}</title>
            </rect>
          );
        })}

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
        {pathModel ? (
          <path
            d={pathModel}
            fill="none"
            stroke={COL_MODEL}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {bins.map((b, i) => {
          if (b.totalSessions === 0) return null;
          const cx = xAt(i, bins.length);
          const wHit = Math.max(barW + 8, 22);
          const x0 = cx - wHit / 2;
          const tip = `${b.barLabel ?? b.date}: conf ${b.avgConfidencePct?.toFixed(1) ?? '—'}% · match ${b.modelVsCorrectionPct?.toFixed(1) ?? '—'}%`;
          return (
            <rect
              key={`hit-${b.date}`}
              x={x0}
              y={padT}
              width={wHit}
              height={innerH + 36}
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
          <span className="dashboard-improvement-legend-swatch" style={{ background: COL_BAR }} />
          Images
        </li>
        <li>
          <span className="dashboard-improvement-legend-line" style={{ borderColor: COL_CONF }} />
          Avg confidence
        </li>
        <li>
          <span className="dashboard-improvement-legend-line" style={{ borderColor: COL_MODEL }} />
          Reading match
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
