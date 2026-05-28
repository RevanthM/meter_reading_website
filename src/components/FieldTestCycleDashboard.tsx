import { useMemo, type FC } from 'react';
import type { FieldTestRollup, UnitTestRunDetailResponse } from '../services/api';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';
import DialPctDonut from './DialPctDonut';
import { resolveDialStats } from '../utils/unitTestCsvAnalytics';

type Props = {
  rollup: FieldTestRollup;
};

const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';

const FieldTestCycleDashboard: FC<Props> = ({ rollup }) => {
  const detail = useMemo((): UnitTestRunDetailResponse => {
    const summary = {
      ...rollup.summary,
      imagesProcessed: rollup.captureCount,
      accuracyPercent: rollup.summary.accuracyPercent ?? null,
      average_confidence: rollup.summary.average_confidence,
    };
    return {
      key: `field-test-cycle:${rollup.cycleId}`,
      summary,
      imageDifficultyBreakdown: rollup.imageDifficultyBreakdown,
      perImageCount: rollup.perImageCount,
      perImageRows: rollup.perImageRows,
    };
  }, [rollup]);

  const dialStats = useMemo(() => resolveDialStats(detail), [detail]);
  const hasDialDonuts = dialStats.some((d) => d.accuracyPct != null || d.confidencePct != null);

  const readAccuracyPct =
    rollup.readsWithGroundTruth > 0
      ? Math.round((1000 * rollup.readsCorrect) / rollup.readsWithGroundTruth) / 10
      : null;

  return (
    <div className="field-test-cycle-dashboard">
      <div className="field-test-kpi-strip" aria-label="Field test summary">
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Captures</span>
          <strong className="field-test-kpi-value">{rollup.captureCount.toLocaleString()}</strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Reads</span>
          <strong className="field-test-kpi-value">{rollup.totalReads.toLocaleString()}</strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Read accuracy</span>
          <strong className="field-test-kpi-value">
            {readAccuracyPct != null ? `${readAccuracyPct}%` : '—'}
          </strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Reads corrected</span>
          <strong className="field-test-kpi-value">{rollup.readsCorrected.toLocaleString()}</strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">% corrections</span>
          <strong className="field-test-kpi-value">
            {rollup.correctionPct != null ? `${rollup.correctionPct.toFixed(1)}%` : '—'}
          </strong>
        </div>
      </div>

      {hasDialDonuts ? (
        <div className="analytics-details-block field-test-dial-donuts-block">
          <header className="analytics-details-block-head">
            <h4>Per-dial — cycle aggregate</h4>
            <p className="analytics-details-block-lead">
              Same layout as Metrics: four dials, accuracy and confidence across all captures in this cycle.
            </p>
          </header>
          <div className="analytics-donut-sections">
            <div className="analytics-donut-section">
              <h5>Accuracy</h5>
              <div className="analytics-donut-grid">
                {dialStats.map((d) => (
                  <DialPctDonut
                    key={`ft-acc-${d.dial}`}
                    dial={d.dial}
                    pct={d.accuracyPct}
                    metricLabel="accuracy"
                    fill={ACCURACY_FILL}
                  />
                ))}
              </div>
            </div>
            <div className="analytics-donut-section">
              <h5>Confidence</h5>
              <div className="analytics-donut-grid">
                {dialStats.map((d) => (
                  <DialPctDonut
                    key={`ft-conf-${d.dial}`}
                    dial={d.dial}
                    pct={d.confidencePct}
                    metricLabel="confidence"
                    fill={CONFIDENCE_FILL}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <DashboardUnitTestCsvCharts detail={detail} reportCapture />
    </div>
  );
};

export default FieldTestCycleDashboard;
