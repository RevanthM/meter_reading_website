import type { FC, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, GraduationCap, ImageIcon } from 'lucide-react';
import type { DashboardCounts } from '../types';
import type { PortalWorkMode } from '../utils/portalWorkMode';
import { formatPortalWeekdayMedium, calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';

type KpiMiniProps = {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  variant?: 'default' | 'accent' | 'danger' | 'warning';
  loading?: boolean;
};

const KpiMiniCard: FC<KpiMiniProps> = ({
  label,
  value,
  hint,
  onClick,
  variant = 'default',
  loading = false,
}) => (
  <button
    type="button"
    className={[
      'dashboard-kpi-item',
      variant !== 'default' ? `dashboard-kpi-item--${variant}` : '',
      loading ? 'dashboard-kpi-item--loading' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onClick}
    disabled={loading}
  >
    <span className="dashboard-kpi-label">{label}</span>
    <span className="dashboard-kpi-value">{loading ? '—' : value}</span>
    {hint ? <span className="dashboard-kpi-hint">{hint}</span> : null}
  </button>
);

function kpiCount(n: number, loading: boolean): string {
  return loading ? '—' : n.toLocaleString();
}

type RoleHomeShellProps = {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
};

const RoleHomeShell: FC<RoleHomeShellProps> = ({ title, subtitle, icon, children }) => (
  <main className="dashboard-content dashboard-content--role-home">
    <header className="dashboard-role-home-header">
      <div className="dashboard-role-home-icon" aria-hidden>
        {icon}
      </div>
      <div>
        <h2 className="dashboard-role-home-title">{title}</h2>
        <p className="dashboard-role-home-subtitle">{subtitle}</p>
      </div>
    </header>
    {children}
  </main>
);

function HeroCta({
  label,
  description,
  count,
  loading,
  onClick,
  variant = 'primary',
}: {
  label: string;
  description: string;
  count?: string;
  loading?: boolean;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      className={`dashboard-role-hero-cta dashboard-role-hero-cta--${variant}`}
      onClick={onClick}
      disabled={loading}
    >
      <span className="dashboard-role-hero-cta-label">{label}</span>
      {count != null ? <span className="dashboard-role-hero-cta-count">{loading ? '—' : count}</span> : null}
      <span className="dashboard-role-hero-cta-desc">{description}</span>
    </button>
  );
}

export type DashboardRoleHomeProps = {
  role: PortalWorkMode;
  counts: DashboardCounts;
  countsLoading: boolean;
  incorrectQueuesTotal: number;
};

export const DashboardRoleHome: FC<DashboardRoleHomeProps> = ({
  role,
  counts,
  countsLoading,
  incorrectQueuesTotal,
}) => {
  const navigate = useNavigate();
  const todayHint = formatPortalWeekdayMedium(new Date().toISOString());
  const todayIso = calendarDayKeyInPortalTz(new Date().toISOString());

  if (role === 'reviewer') {
    return (
      <RoleHomeShell
        title="Review queue"
        subtitle="Set outcomes, correct readings, and route sessions to training or test dataset."
        icon={<ClipboardCheck size={28} strokeWidth={2} />}
      >
        <HeroCta
          label="Awaiting review"
          description="New captures not manually reviewed yet"
          count={kpiCount(counts.incorrectNewCount, countsLoading)}
          loading={countsLoading}
          onClick={() => navigate('/readings/incorrect_new')}
          variant="primary"
        />
        <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
          <KpiMiniCard
            label="Correct"
            value={kpiCount(counts.correctCount, countsLoading)}
            hint="Reviewed · good read"
            onClick={() => navigate('/readings/correct')}
            loading={countsLoading}
          />
          <KpiMiniCard
            label="Wrong (reviewed)"
            value={kpiCount(incorrectQueuesTotal, countsLoading)}
            hint="Incorrect pipeline folders"
            onClick={() => navigate('/readings/incorrect-queues')}
            variant="warning"
            loading={countsLoading}
          />
          <KpiMiniCard
            label="Uploaded today"
            value={kpiCount(counts.uploadedTodayCount ?? 0, countsLoading)}
            hint={`${todayHint} · drill down by day`}
            onClick={() => navigate(`/readings/all?date=${encodeURIComponent(todayIso)}`)}
            variant="accent"
            loading={countsLoading}
          />
          <KpiMiniCard
            label="Not sure / No dials"
            value={kpiCount(counts.notSureCount + counts.noDialsCount, countsLoading)}
            hint="Open lists"
            onClick={() => navigate('/readings/not_sure')}
            loading={countsLoading}
          />
        </div>
      </RoleHomeShell>
    );
  }

  if (role === 'test_data_reviewer') {
    return (
      <RoleHomeShell
        title="Test data"
        subtitle="Approve reviewer picks into unit test images and update the manifest."
        icon={<ImageIcon size={28} strokeWidth={2} />}
      >
        <HeroCta
          label="Pending test data"
          description="Sessions marked send to test dataset"
          onClick={() => navigate('/test-data/pending')}
          variant="primary"
        />
        <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
          <KpiMiniCard
            label="Unit test images"
            value="Browse"
            hint="Flat folder + unittestng_manifest.xlsx"
            onClick={() => navigate('/test-data/images')}
            variant="accent"
          />
          <KpiMiniCard
            label="All sessions"
            value={kpiCount(counts.totalPictures, countsLoading)}
            hint="Full list (reference)"
            onClick={() => navigate('/readings/all')}
            loading={countsLoading}
          />
        </div>
      </RoleHomeShell>
    );
  }

  if (role === 'labeler') {
    const pipelineTotal =
      counts.incorrectAnalyzedCount + counts.incorrectLabeledCount + counts.incorrectTrainingCount;
    return (
      <RoleHomeShell
        title="Training & labeling"
        subtitle="Copy sessions into training datasets, move pipeline stages, and export ZIPs."
        icon={<GraduationCap size={28} strokeWidth={2} />}
      >
        <HeroCta
          label="Model Training Center"
          description="Pipelines · copy sessions · weights"
          onClick={() => navigate('/training')}
          variant="primary"
        />
        <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
          <KpiMiniCard
            label="Training picks"
            value="Open"
            hint="Reviewer marked send to training"
            onClick={() => navigate('/readings/all?cohort=training')}
            variant="accent"
          />
          <KpiMiniCard
            label="Analyzed"
            value={kpiCount(counts.incorrectAnalyzedCount, countsLoading)}
            onClick={() => navigate('/readings/incorrect_analyzed')}
            loading={countsLoading}
          />
          <KpiMiniCard
            label="Labeled"
            value={kpiCount(counts.incorrectLabeledCount, countsLoading)}
            onClick={() => navigate('/readings/incorrect_labeled')}
            loading={countsLoading}
          />
          <KpiMiniCard
            label="In training set"
            value={kpiCount(counts.incorrectTrainingCount, countsLoading)}
            onClick={() => navigate('/readings/incorrect_training')}
            loading={countsLoading}
          />
          <KpiMiniCard
            label="Pipeline total"
            value={kpiCount(pipelineTotal, countsLoading)}
            hint="Analyzed + labeled + training"
            onClick={() => navigate('/readings/incorrect-queues')}
            variant="warning"
            loading={countsLoading}
          />
        </div>
      </RoleHomeShell>
    );
  }

  return null;
};
