import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useReadings, type DataSource } from '../context/ReadingsContext';
import {
  Gauge,
  RefreshCw,
  Cloud,
  HardDrive,
  Loader2,
  Radio,
  Monitor,
  Layers,
  ChevronDown,
  Briefcase,
  Download,
} from 'lucide-react';
import type { WorkType } from '../types';
import { workTypeLabels } from '../types';
import {
  downloadIncorrectRetrainZip,
  fetchPipelineIterations,
  PIPELINE_REGISTRY_UPDATED_EVENT,
  type PipelineIterationRecord,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { getStoredPortalWorkMode } from '../utils/portalWorkMode';
import { DashboardRoleHome } from './DashboardRoleHome';
import {
  enrichIterationRegistryRows,
} from '../utils/iterationMetricsEnrichment';
import DashboardTrainingAnalyticsSection from './DashboardTrainingAnalyticsSection';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';

const Dashboard: FC = () => {
  const {
    counts,
    countsLoading,
    error,
    isUsingRealData,
    refreshCounts,
    dataSource,
    setDataSource,
    workType,
    setWorkType,
  } = useReadings();
  const [zipExporting, setZipExporting] = useState(false);
  const [registryIterations, setRegistryIterations] = useState<PipelineIterationRecord[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [pipelineLineFilter, setPipelineLineFilter] = useState<ChartPipelineFilter>('all');

  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const portalRole = outletCtx?.workMode ?? getStoredPortalWorkMode();
  const isAdminDashboard = portalRole === 'admin';
  const isModelTrainer = portalRole === 'labeler';
  const showTrainingAnalytics = isAdminDashboard || isModelTrainer;

  const glanceCounts = counts;
  const kpiDataLoading = countsLoading;

  const enrichedRegistryAll = useMemo(
    () => enrichIterationRegistryRows(registryIterations),
    [registryIterations],
  );

  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true);
    try {
      const doc = await fetchPipelineIterations();
      setRegistryIterations(doc.iterations ?? []);
    } catch {
      setRegistryIterations([]);
    } finally {
      setRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showTrainingAnalytics) {
      setRegistryIterations([]);
      setRegistryLoading(false);
      return;
    }

    let cancelled = false;
    void loadRegistry().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [showTrainingAnalytics, loadRegistry]);

  useEffect(() => {
    if (!showTrainingAnalytics) return;
    const onRegistryUpdated = () => {
      void loadRegistry();
    };
    window.addEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
    return () => window.removeEventListener(PIPELINE_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
  }, [showTrainingAnalytics, loadRegistry]);

  const incorrectQueuesTotal = useMemo(
    () =>
      glanceCounts.incorrectNewCount +
      glanceCounts.incorrectAnalyzedCount +
      glanceCounts.incorrectLabeledCount +
      glanceCounts.incorrectTrainingCount,
    [glanceCounts],
  );

  const refreshDashboardLight = useCallback(async () => {
    await refreshCounts();
    if (!showTrainingAnalytics) return;
    await loadRegistry();
  }, [showTrainingAnalytics, loadRegistry, refreshCounts]);

  const dashboardSubtitle = isAdminDashboard
    ? 'Analytics & registry'
    : portalRole === 'reviewer'
      ? 'Review queue & outcomes'
      : portalRole === 'test_data_reviewer'
        ? 'Test data approval'
        : 'Pipeline metrics by iteration';

  const handleDownloadIncorrectZip = async () => {
    if (!isUsingRealData) {
      window.alert('Connect to live S3 data first (start the API server), then try again.');
      return;
    }
    setZipExporting(true);
    try {
      await downloadIncorrectRetrainZip(dataSource, workType);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setZipExporting(false);
    }
  };

  const sourceOptions: { value: DataSource; label: string; icon: ReactNode }[] = [
    { value: 'all', label: 'All Sources', icon: <Layers size={14} /> },
    { value: 'field', label: 'Field', icon: <Radio size={14} /> },
    { value: 'simulator', label: 'Simulator', icon: <Monitor size={14} /> },
  ];

  const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];


  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-inner">
          <div className="dashboard-toolbar-main">
            <div className="logo">
              <Gauge size={36} strokeWidth={1.5} />
              <div>
                <h1>Meter Reading</h1>
                <p>{dashboardSubtitle}</p>
              </div>
            </div>
            <div className="header-actions">
              {isAdminDashboard ? (
              <div className="source-toggle" role="group" aria-label="Data source">
                {sourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`source-btn ${dataSource === option.value ? 'active' : ''}`}
                    onClick={() => setDataSource(option.value)}
                    title={option.label}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              ) : null}
              <div className={`data-source data-source--pill ${isUsingRealData ? 'real' : 'mock'}`}>
                {isUsingRealData ? <Cloud size={15} /> : <HardDrive size={15} />}
                <span>{isUsingRealData ? 'S3' : 'Mock'}</span>
              </div>
              {isAdminDashboard ? (
              <button
                type="button"
                className="export-incorrect-btn"
                onClick={handleDownloadIncorrectZip}
                disabled={zipExporting || !isUsingRealData}
                title="Flat ZIP of incorrect-queue sessions (raw photos + dataset.json at root; Roboflow-friendly)"
              >
                {zipExporting ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
                <span>{zipExporting ? 'ZIP…' : 'Export ZIP'}</span>
              </button>
              ) : null}
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refreshDashboardLight()}
                title={
                  showTrainingAnalytics
                    ? 'Refresh counts and cached charts (does not reload all sessions)'
                    : 'Refresh folder counts'
                }
                aria-busy={countsLoading || (showTrainingAnalytics && registryLoading)}
              >
                <RefreshCw
                  size={17}
                  className={countsLoading || (showTrainingAnalytics && registryLoading) ? 'spin' : ''}
                />
              </button>
            </div>
          </div>
          <div className="dashboard-toolbar-sub">
            <div className="work-type-toolbar">
              <Briefcase size={15} className="work-type-toolbar-icon" aria-hidden />
              <span className="work-type-toolbar-label">Work type</span>
              <div className="work-type-dropdown">
                <select
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value as WorkType)}
                  className="work-type-select"
                  aria-label="Work type"
                >
                  {workTypeOptions.map((wt) => (
                    <option key={wt} value={wt}>
                      {wt} — {workTypeLabels[wt]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="dropdown-icon" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <span className="hint">Start the API server with: npm run server</span>
        </div>
      )}

      {!isAdminDashboard && !isModelTrainer ? (
        <DashboardRoleHome
          role={portalRole}
          counts={glanceCounts}
          countsLoading={kpiDataLoading}
          incorrectQueuesTotal={incorrectQueuesTotal}
        />
      ) : null}

      {isModelTrainer ? (
        <main className="dashboard-content dashboard-content--visual dashboard-content--trainer-graphs">
          <DashboardTrainingAnalyticsSection
            rows={enrichedRegistryAll}
            loading={registryLoading}
            pipelineFilter={pipelineLineFilter}
            onPipelineFilterChange={setPipelineLineFilter}
            isAdmin={false}
            showPerDial
            graphsOnly
          />
        </main>
      ) : null}

      {isAdminDashboard ? (
      <main className="dashboard-content dashboard-content--visual">
        <DashboardTrainingAnalyticsSection
          rows={enrichedRegistryAll}
          loading={registryLoading}
          pipelineFilter={pipelineLineFilter}
          onPipelineFilterChange={setPipelineLineFilter}
          isAdmin
          onOpenRegistry={() => navigate('/pipeline-iterations')}
        />
      </main>
      ) : null}
    </div>
  );
};

export default Dashboard;
