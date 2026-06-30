import { useMemo, type FC } from 'react';
import type { FieldTestRollup, UnitTestRunDetailResponse } from '../services/api';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';
import DialPctDonut from './DialPctDonut';
import { useReadings } from '../context/ReadingsContext';
import {
  averageDialAccuracyPct,
  formatFieldTestDialHoverNote,
  resolveDialStats,
} from '../utils/unitTestCsvAnalytics';
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

  const capturesIncorrect = Math.max(
    0,
    rollup.summary.correct != null && rollup.captureCount > 0
      ? rollup.captureCount - rollup.summary.correct
      : (rollup.capturesMarkedIncorrect ?? 0),
  );

  const dialStats = useMemo(
    () =>
      resolveDialStats(detail, {
        fieldTest: true,
        incorrectCaptureCount: capturesIncorrect,
        dialAccuracyBreakdown: rollup.dialAccuracyBreakdown,
      }),
    [detail, capturesIncorrect, rollup.dialAccuracyBreakdown],
  );
  const avgDialAccuracyPct = useMemo(() => averageDialAccuracyPct(dialStats), [dialStats]);
  const perDialCaptureCount = dialStats[0]?.withGroundTruth ?? rollup.captureCount;
  const hasDialDonuts = dialStats.some((d) => d.accuracyPct != null || d.confidencePct != null);
  const readAccuracyPct =
    rollup.captureCount > 0
      ? roundPortalAccuracyConfidencePct(
          (100 * Math.max(0, rollup.captureCount - capturesIncorrect)) / rollup.captureCount,
        )
      : rollup.summary.accuracyPercent ?? null;

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
          <span className="field-test-kpi-label">Dial reads scored</span>
          <strong className="field-test-kpi-value">{rollup.totalReads.toLocaleString()}</strong>
          <span className="field-test-kpi-sublabel">
            {rollup.captureCount.toLocaleString()} captures × 4 dials (not one combined pool)
          </span>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Dial accuracy (avg)</span>
          <strong className="field-test-kpi-value">
            {formatPortalAccuracyConfidencePct(avgDialAccuracyPct)}
          </strong>
          <span className="field-test-kpi-sublabel">Mean of D1–D4 strict per-capture accuracy</span>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Read accuracy</span>
          <strong className="field-test-kpi-value">
            {formatPortalAccuracyConfidencePct(readAccuracyPct)}
          </strong>
          <span className="field-test-kpi-sublabel">
            {rollup.captureCount > 0
              ? `${Math.max(0, rollup.captureCount - capturesIncorrect)}/${rollup.captureCount} captures correct (reviewer)`
              : 'Reviewer correct / incorrect verdict'}
          </span>
        </div>
        <div className="field-test-kpi-card">
          <span className="field-test-kpi-label">Marked incorrect</span>
          <strong className="field-test-kpi-value">{capturesIncorrect.toLocaleString()}</strong>
          <span className="field-test-kpi-sublabel">
            {rollup.explicitDialCorrections != null && rollup.explicitDialCorrections > 0
              ? `${rollup.explicitDialCorrections} explicit dial flags on those captures`
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
              Each dial is scored on {perDialCaptureCount.toLocaleString()} captures. Hover a dial for incorrect counts.
            </p>
          </header>
          <div className="analytics-donut-sections">
            <div className="analytics-donut-section">
              <h5>Dial accuracy</h5>
              <div className="analytics-donut-grid field-test-dial-donut-grid--with-avg">
                {avgDialAccuracyPct != null ? (
                  <DialPctDonut
                    key="ft-acc-avg"
                    dial={0}
                    title="All dials (avg)"
                    pct={avgDialAccuracyPct}
                    metricLabel="accuracy"
                    fill={ACCURACY_FILL}
                  />
                ) : null}
                {dialStats.map((d) => (
                  <DialPctDonut
                    key={`ft-acc-${d.dial}`}
                    dial={d.dial}
                    pct={d.accuracyPct}
                    metricLabel="accuracy"
                    fill={ACCURACY_FILL}
                    countNote={formatFieldTestDialHoverNote(d)}
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
        metricsMode="field_test"
        incorrectCaptureCount={capturesIncorrect}
      />
    </div>
  );
};

export default FieldTestCycleDashboard;
