import { useMemo, type FC } from 'react';
import type { FieldTestRollup, UnitTestRunDetailResponse } from '../services/api';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';
import DialPctDonut from './DialPctDonut';
import { useReadings } from '../context/ReadingsContext';
import { resolveDialStats } from '../utils/unitTestCsvAnalytics';
import {
  formatPortalAccuracyConfidencePct,
  roundPortalAccuracyConfidencePct,
} from '../utils/portalMetricFormat';

type Props = {
  rollup: FieldTestRollup;
};

const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';

const FieldTestCycleDashboard: FC<Props> = ({ rollup }) => {
  const { workType } = useReadings();
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
    rollup.summary.accuracyPercent != null && Number.isFinite(rollup.summary.accuracyPercent)
      ? rollup.summary.accuracyPercent
      : rollup.readsWithGroundTruth > 0
        ? roundPortalAccuracyConfidencePct((100 * rollup.readsCorrect) / rollup.readsWithGroundTruth)
        : null;

  return (
    <div className="field-test-cycle-dashboard">
      <div className="field-test-kpi-strip" aria-label="Field test summary">
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Captures scored</span>
          <strong className="field-test-kpi-value">{rollup.captureCount.toLocaleString()}</strong>
          {rollup.excludedFromResultsCount != null && rollup.excludedFromResultsCount > 0 ? (
            <span className="field-test-kpi-sublabel">
              {rollup.excludedFromResultsCount} excluded (not correct/incorrect)
            </span>
          ) : null}
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Reads</span>
          <strong className="field-test-kpi-value">{rollup.totalReads.toLocaleString()}</strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Read accuracy</span>
          <strong className="field-test-kpi-value">
            {formatPortalAccuracyConfidencePct(readAccuracyPct)}
          </strong>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Marked incorrect</span>
          <strong className="field-test-kpi-value">
            {(rollup.capturesMarkedIncorrect ?? rollup.readsCorrected).toLocaleString()}
          </strong>
          <span className="field-test-kpi-sublabel">
            {rollup.explicitDialCorrections != null && rollup.explicitDialCorrections > 0
              ? `${rollup.explicitDialCorrections} dial flags`
              : rollup.dialsModelWrong != null && rollup.dialsModelWrong > 0
                ? `${rollup.dialsModelWrong} dial${rollup.dialsModelWrong === 1 ? '' : 's'} wrong vs truth`
                : 'Reviewer marked incorrect on portal'}
          </span>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">% marked incorrect</span>
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

      <DashboardUnitTestCsvCharts
        detail={detail}
        reportCapture
        confusionImageSource="field_test"
        workType={workType}
      />
    </div>
  );
};

export default FieldTestCycleDashboard;
