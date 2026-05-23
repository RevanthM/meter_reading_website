import { useMemo, useState, type FC } from 'react';
import type { UnitTestRunDetailResponse } from '../services/api';
import { buildDigitConfusionMatrix, confusionCellTone } from '../utils/unitTestCsvAnalytics';

type Props = {
  perImageRows: UnitTestRunDetailResponse['perImageRows'];
  /** Include in PDF capture sections. */
  reportCapture?: boolean;
  reportSection?: string;
};

const UnitTestConfusionHeatmap: FC<Props> = ({
  perImageRows,
  reportCapture = false,
  reportSection,
}) => {
  const [confusionDial, setConfusionDial] = useState<number | 'all'>('all');

  const confusion = useMemo(() => {
    if (!perImageRows?.length) return null;
    return buildDigitConfusionMatrix(perImageRows, confusionDial);
  }, [perImageRows, confusionDial]);

  const confusionMax = useMemo(() => {
    if (!confusion) return 0;
    return Math.max(0, ...confusion.matrix.flat());
  }, [confusion]);

  if (!confusion || confusion.total <= 0) {
    return (
      <p className="pipeline-iterations-chart-card-placeholder">
        Confusion heatmap needs per-image rows with expected and predicted digits.
      </p>
    );
  }

  return (
    <div
      className="dashboard-pipeline-essential-card dashboard-confusion-card"
      {...(reportCapture
        ? {
            'data-report-capture': 'Confusion heatmap',
            ...(reportSection ? { 'data-report-section': reportSection } : {}),
          }
        : {})}
    >
      <div className="dashboard-confusion-head">
        <div>
          <h5>Confusion heatmap (expected → predicted)</h5>
          <p className="dashboard-pipeline-essential-sub">
            Rows = correct digit from filename · columns = model prediction. Off-diagonal cells show common
            misreads ({confusion.total} dial readings).
          </p>
        </div>
        <div className="dashboard-confusion-dial-toggle" role="group" aria-label="Dial for confusion matrix">
          {(['all', 1, 2, 3, 4] as const).map((d) => (
            <button
              key={String(d)}
              type="button"
              className={`dashboard-improvement-metric-btn${
                confusionDial === d ? ' dashboard-improvement-metric-btn--active' : ''
              }`}
              onClick={() => setConfusionDial(d)}
              aria-pressed={confusionDial === d}
            >
              {d === 'all' ? 'All dials' : `Dial ${d}`}
            </button>
          ))}
        </div>
      </div>
      <div className="dashboard-confusion-table-wrap">
        <table className="dashboard-confusion-table">
          <thead>
            <tr>
              <th scope="col">Expected \ Pred</th>
              {confusion.digits.map((d) => (
                <th key={d} scope="col">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {confusion.digits.map((expDigit, ei) => (
              <tr key={expDigit}>
                <th scope="row">{expDigit}</th>
                {confusion.digits.map((predDigit, pi) => {
                  const count = confusion.matrix[ei][pi];
                  const tone = confusionCellTone(count, confusionMax, ei, pi);
                  return (
                    <td
                      key={predDigit}
                      className={`dashboard-confusion-cell dashboard-confusion-cell--${tone}`}
                      title={`Expected ${expDigit}, predicted ${predDigit}: ${count}`}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UnitTestConfusionHeatmap;
