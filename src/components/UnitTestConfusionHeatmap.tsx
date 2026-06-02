import { useMemo, useState, type FC, type KeyboardEvent } from 'react';
import type { UnitTestRunDetailResponse } from '../services/api';
import type { WorkType } from '../types';
import {
  buildDigitConfusionMatrix,
  CONFUSION_LEGEND_TICKS,
  CONFUSION_MISREAD_LEGEND_TICKS,
  type ConfusionMatrixOptions,
  confusionMatrixCellFill,
  confusionMatrixCellText,
  confusionRowRecall,
  confusionRowShare,
  confusionRowTotal,
  filterConfusionMisreadRows,
  formatConfusionPct,
} from '../utils/unitTestCsvAnalytics';
import ConfusionMisreadLightbox, { type ConfusionImageSource } from './ConfusionMisreadLightbox';

type Props = {
  perImageRows: UnitTestRunDetailResponse['perImageRows'];
  /** Include in PDF capture sections. */
  reportCapture?: boolean;
  reportSection?: string;
  /** When set, off-diagonal cells open the matching image(s). */
  imageSource?: ConfusionImageSource;
  workType?: WorkType;
};

function legendGradient(stops: string): string {
  return `linear-gradient(to right, ${stops})`;
}

const RECALL_LEGEND = legendGradient(
  '#dc2626 0%, #fde68a 35%, #86efac 65%, #15803d 100%',
);
const MISREAD_LEGEND = legendGradient(
  '#f8fafc 0%, #fef3c7 20%, #fde68a 40%, #f59e0b 60%, #ea580c 80%, #dc2626 100%',
);

type OpenCell = {
  expectedDigit: number;
  predictedDigit: number;
  rows: Record<string, string>[];
};

const UnitTestConfusionHeatmap: FC<Props> = ({
  perImageRows,
  reportCapture = false,
  reportSection,
  imageSource,
  workType,
}) => {
  const [confusionDial, setConfusionDial] = useState<number | 'all'>('all');
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);

  const rows = perImageRows ?? [];

  const confusionOptions = useMemo((): ConfusionMatrixOptions | undefined => {
    return imageSource === 'field_test' ? { strictModelPrediction: true } : undefined;
  }, [imageSource]);

  const confusion = useMemo(() => {
    if (!rows.length) return null;
    return buildDigitConfusionMatrix(rows, confusionDial, confusionOptions);
  }, [rows, confusionDial, confusionOptions]);

  const canDrillIntoMisreads = Boolean(imageSource && workType && rows.length);

  if (!confusion || confusion.total <= 0) {
    return (
      <p className="pipeline-iterations-chart-card-placeholder">
        Not enough data to display this matrix.
      </p>
    );
  }

  const title =
    confusionDial === 'all'
      ? 'Digit confusion matrix (all dials)'
      : `Digit confusion matrix — dial ${confusionDial}`;

  const handleMisreadClick = (expectedDigit: number, predictedDigit: number) => {
    if (!canDrillIntoMisreads) return;
    const matched = filterConfusionMisreadRows(
      rows,
      expectedDigit,
      predictedDigit,
      confusionDial,
      confusionOptions,
    );
    if (!matched.length) return;
    setOpenCell({ expectedDigit, predictedDigit, rows: matched });
  };

  return (
    <>
      <div
        className="dashboard-pipeline-essential-card dashboard-confusion-card"
        {...(reportCapture
          ? {
              'data-report-capture': 'Digit confusion matrix',
              ...(reportSection ? { 'data-report-section': reportSection } : {}),
            }
          : {})}
      >
        <div className="dashboard-confusion-head">
          <div>
            <h5>{title}</h5>
            <p className="dashboard-pipeline-essential-sub">
              {confusion.total} dial readings · each row is normalized to 100% (standard ML confusion
              matrix)
            </p>
            <p className="dashboard-confusion-help">
              <strong>Rows</strong> = true digit on the meter. <strong>Columns</strong> ={' '}
              {imageSource === 'field_test'
                ? 'model prediction (strict; dial 4 bill-lower does not count as correct).'
                : 'model prediction.'}{' '}
              <strong>Diagonal (green)</strong> = predicted digit matches true digit (95% red → 100%
              green). <strong>Off-diagonal (amber/red)</strong> = model predicted a different digit
              {canDrillIntoMisreads ? ' — click a count to open the image(s).' : '.'}
            </p>
          </div>
          <div className="dashboard-confusion-head-controls">
            <div className="dashboard-confusion-mode-block">
              <span className="dashboard-confusion-mode-label">Filter by dial</span>
              <div className="dashboard-confusion-dial-toggle" role="group" aria-label="Filter by dial">
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
          </div>
        </div>

        <div className="dashboard-confusion-body dashboard-confusion-body--standard">
          <div className="dashboard-confusion-chart">
            <p className="dashboard-confusion-y-label">True digit</p>
            <div className="dashboard-confusion-table-wrap">
              <table className="dashboard-confusion-table dashboard-confusion-table--standard">
                <thead>
                  <tr>
                    <th scope="col" className="dashboard-confusion-corner" aria-hidden />
                    {confusion.digits.map((d) => (
                      <th key={d} scope="col" className="dashboard-confusion-pred-col">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {confusion.digits.map((expDigit, ei) => {
                    const rowTotal = confusionRowTotal(confusion.matrix, ei);
                    const rowRecall = confusionRowRecall(confusion.matrix, ei);
                    return (
                      <tr key={expDigit}>
                        <th
                          scope="row"
                          className="dashboard-confusion-row-label"
                          title={
                            rowTotal > 0
                              ? `True digit ${expDigit}: ${rowTotal} readings, ${formatConfusionPct(rowRecall)} correct`
                              : undefined
                          }
                        >
                          <span className="dashboard-confusion-row-digit">{expDigit}</span>
                          {rowTotal > 0 ? (
                            <span className="dashboard-confusion-row-n">n={rowTotal}</span>
                          ) : null}
                        </th>
                        {confusion.digits.map((predDigit, pi) => {
                          const count = confusion.matrix[ei][pi];
                          const share = confusionRowShare(confusion.matrix, ei, pi);
                          const isCorrect = ei === pi;
                          const isMisread = count > 0 && !isCorrect;
                          const background = confusionMatrixCellFill(count, share, isCorrect);
                          const color = confusionMatrixCellText(count, share, isCorrect);
                          const expectedNum = parseInt(expDigit, 10);
                          const predictedNum = parseInt(predDigit, 10);
                          return (
                            <td
                              key={predDigit}
                              className={`dashboard-confusion-cell${
                                isCorrect ? ' dashboard-confusion-cell--correct' : ''
                              }${isMisread ? ' dashboard-confusion-cell--misread' : ''}${
                                isMisread && canDrillIntoMisreads
                                  ? ' dashboard-confusion-cell--clickable'
                                  : ''
                              }`}
                              style={{ backgroundColor: background, color }}
                              title={
                                rowTotal > 0
                                  ? isCorrect
                                    ? `True ${expDigit} → predicted ${predDigit}: ${count} of ${rowTotal} (${formatConfusionPct(share)}) — correct`
                                    : `True ${expDigit} → predicted ${predDigit}: ${count} of ${rowTotal} (${formatConfusionPct(share)}) — misread${
                                        canDrillIntoMisreads ? ', click to view images' : ''
                                      }`
                                  : undefined
                              }
                              {...(isMisread && canDrillIntoMisreads
                                ? {
                                    role: 'button',
                                    tabIndex: 0,
                                    onClick: () => handleMisreadClick(expectedNum, predictedNum),
                                    onKeyDown: (e: KeyboardEvent) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleMisreadClick(expectedNum, predictedNum);
                                      }
                                    },
                                  }
                                : {})}
                            >
                              {count > 0 ? (
                                <>
                                  <span className="dashboard-confusion-cell-count">{count}</span>
                                  <span className="dashboard-confusion-cell-pct">
                                    {formatConfusionPct(share)}
                                  </span>
                                </>
                              ) : (
                                <span className="dashboard-confusion-cell-empty">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="dashboard-confusion-x-label">Predicted digit</p>
            </div>
          </div>
        </div>

        <div className="dashboard-confusion-legend" aria-label="Color legend">
          <div className="dashboard-confusion-legend-item">
            <p className="dashboard-confusion-legend-title">Correct (diagonal) — recall</p>
            <div
              className="dashboard-confusion-legend-bar"
              style={{ background: RECALL_LEGEND }}
              aria-hidden
            />
            <div className="dashboard-confusion-legend-ticks" aria-hidden>
              {CONFUSION_LEGEND_TICKS.map((tick) => (
                <span key={`c-${tick}`}>{tick}%</span>
              ))}
            </div>
            <p className="dashboard-confusion-legend-caption">95% = red · 100% = green</p>
          </div>
          <div className="dashboard-confusion-legend-item">
            <p className="dashboard-confusion-legend-title">Misread (off-diagonal)</p>
            <div
              className="dashboard-confusion-legend-bar"
              style={{ background: MISREAD_LEGEND }}
              aria-hidden
            />
            <div className="dashboard-confusion-legend-ticks" aria-hidden>
              {CONFUSION_MISREAD_LEGEND_TICKS.map((tick) => (
                <span key={`m-${tick}`}>{tick}%</span>
              ))}
            </div>
            <p className="dashboard-confusion-legend-caption">Darker red = larger share of the row</p>
          </div>
        </div>
      </div>

      {openCell && workType && imageSource ? (
        <ConfusionMisreadLightbox
          workType={workType}
          source={imageSource}
          rows={openCell.rows}
          expectedDigit={openCell.expectedDigit}
          predictedDigit={openCell.predictedDigit}
          dial={confusionDial}
          onClose={() => setOpenCell(null)}
        />
      ) : null}
    </>
  );
};

export default UnitTestConfusionHeatmap;
