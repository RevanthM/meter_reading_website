import { useMemo, type FC, type CSSProperties } from 'react';
import type { PipelineIterationRecord } from '../services/api';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';
import {
  buildLineTrendSummaries,
  deltaTone,
  formatDeltaPp,
} from '../utils/pipelineAnalyticsStory';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

function fmtValue(metric: 'images' | 'accuracy' | 'confidence', v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (metric === 'images') return v.toLocaleString();
  return formatPortalAccuracyConfidencePct(v);
}

type Props = {
  rows: PipelineIterationRecord[];
  pipelineFilter: ChartPipelineFilter;
  metric: 'images' | 'accuracy' | 'confidence';
};

const DashboardTrendDeltaStrip: FC<Props> = ({ rows, pipelineFilter, metric }) => {
  const summaries = useMemo(
    () => buildLineTrendSummaries(rows, pipelineFilter, metric),
    [rows, pipelineFilter, metric],
  );

  if (!summaries.length) return null;

  const unit = metric === 'images' ? '' : 'pp';

  return (
    <div className="analytics-trend-strip">
      {summaries.map((s) => {
        const tone = deltaTone(s.deltaVsPrevious);
        return (
          <span
            key={s.line}
            className="analytics-trend-strip__item"
            style={{ '--line-color': s.stroke } as CSSProperties}
          >
            <span className="analytics-trend-strip__dot" aria-hidden />
            <span className="analytics-trend-strip__line">{s.label}</span>
            <span className="analytics-trend-strip__val">{fmtValue(metric, s.latestValue)}</span>
            {s.deltaVsPrevious != null && s.previousIteration != null ? (
              <span className={`analytics-trend-strip__delta analytics-trend-strip__delta--${tone}`}>
                {formatDeltaPp(s.deltaVsPrevious, unit)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

export default DashboardTrendDeltaStrip;
