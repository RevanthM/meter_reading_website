import type { FC } from 'react';
import { BarChart3, FileStack, TrendingUp } from 'lucide-react';

export type AnalyticsStorySection = 'current' | 'progress' | 'all';

export const ANALYTICS_SECTION_IDS: Record<AnalyticsStorySection, string> = {
  current: 'dashboard-analytics-current',
  progress: 'dashboard-analytics-progress',
  all: 'dashboard-analytics-all',
};

type TabDef = {
  id: AnalyticsStorySection;
  step: string;
  label: string;
  description: string;
  icon: FC<{ size?: number; strokeWidth?: number }>;
};

const TABS: TabDef[] = [
  {
    id: 'current',
    step: '1',
    label: 'Current',
    description: 'Latest eval snapshot per pipeline',
    icon: BarChart3,
  },
  {
    id: 'progress',
    step: '2',
    label: 'Progress',
    description: 'Metrics tracked across iterations',
    icon: TrendingUp,
  },
  {
    id: 'all',
    step: '3',
    label: 'All details',
    description: 'Per-dial breakdown & report data',
    icon: FileStack,
  },
];

type Props = {
  active: AnalyticsStorySection;
  onChange: (section: AnalyticsStorySection) => void;
  showReportHint?: boolean;
};

const DashboardAnalyticsStoryNav: FC<Props> = ({ active, onChange, showReportHint = false }) => {
  return (
    <div className="analytics-shell-tabs" role="tablist" aria-label="Analytics views">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        const description =
          tab.id === 'all' && showReportHint
            ? 'Per-dial charts, summary table & PDF report'
            : tab.description;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`analytics-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={ANALYTICS_SECTION_IDS[tab.id]}
            className={`analytics-shell-tab${isActive ? ' analytics-shell-tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            <span className="analytics-shell-tab-step">{tab.step}</span>
            <span className="analytics-shell-tab-body">
              <span className="analytics-shell-tab-title-row">
                <Icon size={15} strokeWidth={2} aria-hidden />
                <span className="analytics-shell-tab-label">{tab.label}</span>
              </span>
              <span className="analytics-shell-tab-desc">{description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default DashboardAnalyticsStoryNav;
