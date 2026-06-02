import { useMemo, type FC, type CSSProperties } from 'react';
import type { PipelineIterationRecord } from '../services/api';
import { FACTORY_PRODUCT_LINE_CHART } from '../constants/pipelineChartTheme';
import {
  buildReportIterationDetails,
  deltaTone,
  formatDeltaPp,
} from '../utils/pipelineAnalyticsStory';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

function fmtPct(v: number | null | undefined): string {
  return formatPortalAccuracyConfidencePct(v);
}

function fmtNum(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toLocaleString() : '—';
}

type Props = {
  rows: PipelineIterationRecord[];
  /** Full registry rows for pp vs previous (when `rows` is latest-only). */
  allRowsForDelta?: PipelineIterationRecord[];
  showReportCheckbox?: boolean;
  selectedReportIds?: Set<string>;
  onToggleReport?: (id: string) => void;
  latestOnly?: boolean;
};

const DashboardReportIterationBlocks: FC<Props> = ({
  rows,
  allRowsForDelta,
  showReportCheckbox = false,
  selectedReportIds,
  onToggleReport,
  latestOnly = false,
}) => {
  const details = useMemo(
    () => buildReportIterationDetails(rows, allRowsForDelta),
    [rows, allRowsForDelta],
  );
  const isReportChecked = (id: string) => selectedReportIds?.has(id) ?? false;

  if (!details.length) return null;

  return (
    <>
      <header className="analytics-details-block__head">
        <h4>{latestOnly ? 'Latest iterations' : 'All iterations'}</h4>
        <p>
          {latestOnly
            ? 'Latest eval snapshot per pipeline with pp vs the previous iteration.'
            : 'Select iterations to include in the PDF report and unit test results. Current shows the latest only.'}
        </p>
      </header>
      <div className="dashboard-report-iteration-blocks">
        {details.map((d) => {
          const theme = FACTORY_PRODUCT_LINE_CHART[d.line];
          const accTone = deltaTone(d.accuracyDelta);
          const confTone = deltaTone(d.confidenceDelta);
          const included = isReportChecked(d.id);
          return (
            <article
              key={d.id}
              className={`dashboard-report-iteration-block${
                included ? '' : ' dashboard-report-iteration-block--excluded'
              }`}
              data-report-capture={included ? `${d.pipeline} #${d.iterationNumber}` : undefined}
              data-report-section={included ? 'Iterations' : undefined}
              style={{ '--block-accent': theme.stroke } as CSSProperties}
            >
              <header className="dashboard-report-iteration-block-head">
                <div>
                  <span
                    className="dashboard-report-iteration-block-dot"
                    style={{ background: theme.stroke }}
                    aria-hidden
                  />
                  <h4>
                    {d.pipeline}
                    <span className="dashboard-report-iteration-block-iter">#{d.iterationNumber}</span>
                  </h4>
                  <p className="dashboard-report-iteration-block-meta">
                    {theme.label}
                    {d.appVersion !== '—' ? ` · v${d.appVersion}` : ''}
                  </p>
                </div>
                <div className="dashboard-report-iteration-block-head-actions">
                  {showReportCheckbox && onToggleReport ? (
                    <label className="analytics-snapshot-report-check">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => onToggleReport(d.id)}
                      />
                      <span>Include in report</span>
                    </label>
                  ) : null}
                  <div className="dashboard-report-iteration-block-deltas">
                    {d.accuracyDelta != null ? (
                      <span
                        className={`dashboard-report-iteration-delta dashboard-report-iteration-delta--${accTone}`}
                      >
                        Acc {formatDeltaPp(d.accuracyDelta)}
                      </span>
                    ) : null}
                    {d.confidenceDelta != null ? (
                      <span
                        className={`dashboard-report-iteration-delta dashboard-report-iteration-delta--${confTone}`}
                      >
                        Conf {formatDeltaPp(d.confidenceDelta)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </header>

              <div className="dashboard-report-iteration-metrics">
                <div className="dashboard-report-iteration-metric">
                  <span className="dashboard-report-iteration-metric-k">Read accuracy</span>
                  <span className="dashboard-report-iteration-metric-v">{fmtPct(d.readAccuracyPct)}</span>
                </div>
                <div className="dashboard-report-iteration-metric">
                  <span className="dashboard-report-iteration-metric-k">Confidence</span>
                  <span className="dashboard-report-iteration-metric-v">{fmtPct(d.readConfidencePct)}</span>
                </div>
                <div className="dashboard-report-iteration-metric">
                  <span className="dashboard-report-iteration-metric-k">Exact reading</span>
                  <span className="dashboard-report-iteration-metric-v">{fmtPct(d.exactReadingPct)}</span>
                </div>
                <div className="dashboard-report-iteration-metric">
                  <span className="dashboard-report-iteration-metric-k">Training images</span>
                  <span className="dashboard-report-iteration-metric-v">{fmtNum(d.trainingImages)}</span>
                </div>
                <div className="dashboard-report-iteration-metric">
                  <span className="dashboard-report-iteration-metric-k">UT images</span>
                  <span className="dashboard-report-iteration-metric-v">{fmtNum(d.unitTestImages)}</span>
                </div>
              </div>

              <table className="dashboard-report-iteration-dial-table">
                <thead>
                  <tr>
                    <th scope="col">Dial</th>
                    <th scope="col">Accuracy</th>
                    <th scope="col">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {d.perDial.map((row) => (
                    <tr key={row.dial}>
                      <td>Dial {row.dial}</td>
                      <td>{fmtPct(row.accuracy)}</td>
                      <td>{fmtPct(row.confidence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {d.scopeNote ? (
                <p className="dashboard-report-iteration-scope">
                  <strong>Scope:</strong> {d.scopeNote}
                </p>
              ) : null}
              {d.outcome ? (
                <p className="dashboard-report-iteration-outcome">
                  <strong>Outcome:</strong> {d.outcome}
                </p>
              ) : null}
              {d.linkedCsvName ? (
                <p className="dashboard-report-iteration-csv">
                  <strong>Results:</strong> {d.linkedCsvName}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
};

export default DashboardReportIterationBlocks;
