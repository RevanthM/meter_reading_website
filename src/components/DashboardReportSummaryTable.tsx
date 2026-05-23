import { useMemo, type FC } from 'react';
import type { PipelineIterationRecord } from '../services/api';
import { FACTORY_PRODUCT_LINE_CHART } from '../constants/pipelineChartTheme';
import { buildReportSummaryRows } from '../utils/pipelineAnalyticsStory';

function cell(v: number | null | undefined, pct = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return pct ? `${v.toFixed(1)}%` : v.toLocaleString();
}

type Props = {
  rows: PipelineIterationRecord[];
};

const DashboardReportSummaryTable: FC<Props> = ({ rows }) => {
  const tableRows = useMemo(() => buildReportSummaryRows(rows), [rows]);

  if (!tableRows.length) return null;

  return (
    <div className="analytics-details-block">
      <header className="analytics-details-block__head">
        <h4>Iteration summary</h4>
        <p>Selected iterations — accuracy, confidence, and training data at a glance.</p>
      </header>

      <div className="dashboard-report-table-wrap">
        <table className="dashboard-report-table">
          <thead>
            <tr>
              <th scope="col">Pipeline</th>
              <th scope="col">Iter</th>
              <th scope="col">App</th>
              <th scope="col">Read acc.</th>
              <th scope="col">Confidence</th>
              <th scope="col">Exact</th>
              <th scope="col">Train</th>
              <th scope="col">UT</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => {
              const lineTheme = FACTORY_PRODUCT_LINE_CHART[r.line];
              return (
                <tr key={r.id}>
                  <td>
                    <span
                      className="dashboard-report-table-pipeline-dot"
                      style={{ background: lineTheme.stroke }}
                      aria-hidden
                    />
                    {r.pipeline}
                  </td>
                  <td>#{r.iterationNumber}</td>
                  <td>{r.appVersion}</td>
                  <td className="dashboard-report-table-num">{cell(r.readAccuracyPct, true)}</td>
                  <td className="dashboard-report-table-num">{cell(r.readConfidencePct, true)}</td>
                  <td className="dashboard-report-table-num">{cell(r.exactReadingPct, true)}</td>
                  <td className="dashboard-report-table-num">{cell(r.trainingImages)}</td>
                  <td className="dashboard-report-table-num">{cell(r.unitTestImages)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DashboardReportSummaryTable;
