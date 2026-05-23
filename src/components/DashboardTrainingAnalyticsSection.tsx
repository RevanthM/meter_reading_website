import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { flushSync } from 'react-dom';
import { FileDown, Loader2 } from 'lucide-react';
import type { PipelineIterationRecord } from '../services/api';
import { filterEvalChartRows } from '../constants/pipelineChartTheme';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';
import {
  defaultReportIterationIds,
  filterRowsByReportSelection,
  getStoredReportIterationIds,
  setStoredReportIterationIds,
} from '../utils/reportIterationSelection';
import { generateDashboardReportPdf, waitForReportDomReady } from '../utils/dashboardReportPdf';
import { buildReportSummaryRows } from '../utils/pipelineAnalyticsStory';
import DashboardPipelineEssentials from './DashboardPipelineEssentials';
import PipelineChartLineFilter from './PipelineChartLineFilter';

type Props = {
  rows: PipelineIterationRecord[];
  loading: boolean;
  pipelineFilter: ChartPipelineFilter;
  onPipelineFilterChange: (filter: ChartPipelineFilter) => void;
  isAdmin: boolean;
  onOpenRegistry?: () => void;
  embedded?: boolean;
  showPerDial?: boolean;
  graphsOnly?: boolean;
};

const DashboardTrainingAnalyticsSection: FC<Props> = ({
  rows,
  loading,
  pipelineFilter,
  onPipelineFilterChange,
  isAdmin,
  onOpenRegistry,
  embedded = false,
  showPerDial = true,
  graphsOnly = false,
}) => {
  const reportRootRef = useRef<HTMLDivElement>(null);
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!evalRows.length) {
      setSelectedIds(new Set());
      return;
    }
    const defaults = defaultReportIterationIds(rows, pipelineFilter);
    const stored = getStoredReportIterationIds();
    if (stored && stored.size > 0) {
      const valid = new Set([...stored].filter((id) => evalRows.some((r) => r.id === id)));
      setSelectedIds(valid.size ? valid : defaults);
    } else {
      setSelectedIds(defaults);
    }
  }, [evalRows.length, rows, pipelineFilter]);

  useEffect(() => {
    if (selectedIds.size > 0) {
      setStoredReportIterationIds(selectedIds);
    }
  }, [selectedIds]);

  const reportRows = useMemo(
    () => filterRowsByReportSelection(rows, selectedIds),
    [rows, selectedIds],
  );

  const reportSummaryRows = useMemo(
    () => buildReportSummaryRows(reportRows),
    [reportRows],
  );

  const toggleIteration = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGeneratePdf = useCallback(async () => {
    if (!reportRootRef.current) return;
    setPdfError(null);
    flushSync(() => {
      setPdfGenerating(true);
    });
    reportRootRef.current.classList.add('dashboard-report-capture-root--exporting');
    try {
      await waitForReportDomReady(reportRootRef.current);
      const labels = evalRows
        .filter((r) => selectedIds.has(r.id))
        .map((r) => `${r.pipeline.trim()} #${r.iterationNumber}`)
        .join(', ');
      await generateDashboardReportPdf({
        title: 'AMR Model Training Report',
        subtitle: labels ? `Iterations: ${labels}` : undefined,
        captureRoot: reportRootRef.current,
        filename: 'amr-model-training-report',
        summaryRows: reportSummaryRows,
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      reportRootRef.current?.classList.remove('dashboard-report-capture-root--exporting');
      setPdfGenerating(false);
    }
  }, [evalRows, reportSummaryRows, selectedIds]);

  const sectionClass = [
    'dashboard-section',
    'dashboard-section--viz',
    'dashboard-section--pipeline-registry',
    embedded ? 'dashboard-section--embedded-analytics' : '',
    graphsOnly ? 'dashboard-section--graphs-only' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const analyticsToolbar = (
    <div className="dashboard-analytics-toolbar">
      {!loading && evalRows.length > 0 && !graphsOnly ? (
        <PipelineChartLineFilter value={pipelineFilter} onChange={onPipelineFilterChange} />
      ) : null}
      {evalRows.length > 0 ? (
        <button
          type="button"
          className="dashboard-report-pdf-btn"
          onClick={() => void handleGeneratePdf()}
          disabled={pdfGenerating || selectedIds.size === 0}
          title="Download PDF with pipeline charts and unit test analytics"
        >
          {pdfGenerating ? <Loader2 size={16} className="spin" /> : <FileDown size={16} />}
          <span>{pdfGenerating ? 'Building PDF…' : 'Generate report PDF'}</span>
        </button>
      ) : null}
    </div>
  );

  return (
    <section className={sectionClass}>
      <div
        className={`dashboard-section-head dashboard-section-head--range-top${
          graphsOnly ? ' dashboard-section-head--graphs-only' : ''
        }`}
      >
        {!graphsOnly ? (
          <div>
            <h2 className="section-title">Training & improvement</h2>
            <p className="dashboard-section-sub">
              App accuracy, confidence, and training images by iteration
              {isAdmin && onOpenRegistry ? (
                <>
                  {' '}
                  —{' '}
                  <button type="button" className="training-hub-text-btn" onClick={onOpenRegistry}>
                    edit in registry
                  </button>
                </>
              ) : null}
              . Check iterations on All details to include in the PDF report and load unit-test CSV analytics.
            </p>
            {loading ? <p className="dashboard-section-loading-hint">Loading registry…</p> : null}
            {pdfError ? <p className="dashboard-report-error">{pdfError}</p> : null}
          </div>
        ) : (
          <div className="dashboard-section-head--graphs-only-inner">
            {loading ? <p className="dashboard-section-loading-hint">Loading registry…</p> : null}
            {pdfError ? <p className="dashboard-report-error">{pdfError}</p> : null}
          </div>
        )}
        {analyticsToolbar}
      </div>

      {loading && !rows.length ? (
        <div className="chart-empty chart-empty--tight">
          <Loader2 size={28} className="spin" />
          <span>Loading pipeline registry…</span>
        </div>
      ) : rows.length ? (
        <div ref={reportRootRef} className="dashboard-report-capture-root">
          <DashboardPipelineEssentials
            rows={rows}
            pipelineFilter={pipelineFilter}
            onPipelineFilterChange={onPipelineFilterChange}
            showPerDial={showPerDial}
            showReportSections
            embedPipelineFilter={graphsOnly}
            renderAllPanels={pdfGenerating}
            showReportCheckbox
            selectedReportIds={selectedIds}
            onToggleReport={toggleIteration}
            reportRows={reportRows}
            latestScopeOnly={graphsOnly}
          />
        </div>
      ) : (
        <div className="chart-empty">
          <p>No pipeline iterations yet.</p>
          {isAdmin && onOpenRegistry ? (
            <button type="button" className="view-button" onClick={onOpenRegistry}>
              Open registry
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
};

export default DashboardTrainingAnalyticsSection;
