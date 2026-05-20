import type { FC } from 'react';
import {
  FACTORY_PRODUCT_LINE_CHART,
  PIPELINE_CHART_LINES,
  type ChartPipelineFilter,
} from '../constants/pipelineChartTheme';

type Props = {
  value: ChartPipelineFilter;
  onChange: (value: ChartPipelineFilter) => void;
  className?: string;
};

const PipelineChartLineFilter: FC<Props> = ({ value, onChange, className = '' }) => {
  return (
    <div
      className={`pipeline-chart-line-filter${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Filter charts by pipeline"
    >
      <span className="pipeline-chart-line-filter-label">Pipeline</span>
      <button
        type="button"
        className={`pipeline-chart-line-filter-btn${value === 'all' ? ' pipeline-chart-line-filter-btn--active' : ''}`}
        onClick={() => onChange('all')}
        aria-pressed={value === 'all'}
      >
        All
      </button>
      {PIPELINE_CHART_LINES.map((line) => {
        const theme = FACTORY_PRODUCT_LINE_CHART[line];
        const active = value === line;
        return (
          <button
            key={line}
            type="button"
            className={`pipeline-chart-line-filter-btn${active ? ' pipeline-chart-line-filter-btn--active' : ''}`}
            style={
              active
                ? {
                    borderColor: theme.stroke,
                    background: `color-mix(in srgb, ${theme.fill} 18%, transparent)`,
                    color: theme.stroke,
                  }
                : { borderColor: `color-mix(in srgb, ${theme.stroke} 35%, var(--border-color))` }
            }
            onClick={() => onChange(line)}
            aria-pressed={active}
          >
            <span className="pipeline-chart-line-filter-dot" style={{ background: theme.fill }} />
            {theme.label}
          </button>
        );
      })}
    </div>
  );
};

export default PipelineChartLineFilter;
