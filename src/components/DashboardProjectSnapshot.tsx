import { useMemo, type FC, type CSSProperties } from 'react';
import { Images } from 'lucide-react';
import type { PipelineIterationRecord } from '../services/api';
import type { ChartPipelineFilter } from '../constants/pipelineChartTheme';
import {
  buildCurrentSnapshots,
  buildCurrentScopeSummary,
  deltaTone,
  formatDeltaPp,
  type ProjectSnapshotCard,
} from '../utils/pipelineAnalyticsStory';
import DialPctDonut from './DialPctDonut';
import type { LatestDialAppMetric } from '../constants/pipelineChartTheme';
import { formatPortalAccuracyConfidencePct } from '../utils/portalMetricFormat';

const ACCURACY_FILL = '#0d9488';
const CONFIDENCE_FILL = '#3b82f6';

function fmtPct(v: number | null | undefined): string {
  return formatPortalAccuracyConfidencePct(v);
}

function fmtNum(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toLocaleString() : '—';
}

const DeltaPill: FC<{ label: string; delta: number | null }> = ({ label, delta }) => {
  const tone = deltaTone(delta);
  return (
    <span className={`analytics-delta-pill analytics-delta-pill--${tone}`}>
      {label} {formatDeltaPp(delta)}
    </span>
  );
};

const PerDialDonuts: FC<{ perDial: LatestDialAppMetric[]; compact?: boolean }> = ({
  perDial,
  compact = false,
}) => (
  <div
    className={`analytics-donut-sections analytics-donut-sections--snapshot${
      compact ? ' analytics-donut-sections--compact' : ''
    }`}
    aria-label="Per-dial metrics"
  >
    <div className="analytics-donut-section">
      <h5>Accuracy</h5>
      <div className="analytics-donut-grid">
        {[1, 2, 3, 4].map((d) => {
          const dial = perDial.find((x) => x.dial === d);
          return (
            <DialPctDonut
              key={`acc-${d}`}
              dial={d}
              pct={dial?.accuracy ?? null}
              metricLabel="accuracy"
              fill={ACCURACY_FILL}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
    <div className="analytics-donut-section">
      <h5>Confidence</h5>
      <div className="analytics-donut-grid">
        {[1, 2, 3, 4].map((d) => {
          const dial = perDial.find((x) => x.dial === d);
          return (
            <DialPctDonut
              key={`conf-${d}`}
              dial={d}
              pct={dial?.confidence ?? null}
              metricLabel="confidence"
              fill={CONFIDENCE_FILL}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  </div>
);

type SnapshotCardProps = {
  card: ProjectSnapshotCard;
  expanded?: boolean;
  showReportCheckbox?: boolean;
  reportChecked?: boolean;
  onReportToggle?: (id: string) => void;
  /** Hide program-wide pp (e.g. #1→#5); keep vs-previous pp only. */
  latestPpOnly?: boolean;
};

const SnapshotCard: FC<SnapshotCardProps> = ({
  card,
  expanded = false,
  showReportCheckbox = false,
  reportChecked = false,
  onReportToggle,
  latestPpOnly = false,
}) => (
  <article
    className={`analytics-snapshot-card${expanded ? ' analytics-snapshot-card--expanded' : ''}${
      card.isLatest ? ' analytics-snapshot-card--latest' : ''
    }`}
    style={{ '--line-color': card.stroke } as CSSProperties}
  >
    <header className="analytics-snapshot-card__head">
      <div className="analytics-snapshot-card__identity">
        <span className="analytics-snapshot-card__line">{card.label}</span>
        <h3 className="analytics-snapshot-card__title">
          {card.pipelineName}
          <span className="analytics-snapshot-card__iter">#{card.iterationNumber}</span>
          {card.isLatest ? <span className="analytics-snapshot-card__badge">Latest</span> : null}
        </h3>
      </div>
      <div className="analytics-snapshot-card__head-actions">
        {showReportCheckbox && onReportToggle ? (
          <label className="analytics-snapshot-report-check">
            <input
              type="checkbox"
              checked={reportChecked}
              onChange={() => onReportToggle(card.id)}
            />
            <span>Include in report</span>
          </label>
        ) : null}
        <div className="analytics-snapshot-card__meta">
          {card.evalDate ? <time>{card.evalDate}</time> : null}
          {card.appVersion !== '—' ? <span>v{card.appVersion}</span> : null}
        </div>
      </div>
    </header>

    <div className="analytics-snapshot-card__hero">
      <div className="analytics-snapshot-metric analytics-snapshot-metric--accent">
        <span className="analytics-snapshot-metric__label">Read accuracy</span>
        <span className="analytics-snapshot-metric__value">{fmtPct(card.readAccuracyPct)}</span>
      </div>
      <div className="analytics-snapshot-metric analytics-snapshot-metric--accent">
        <span className="analytics-snapshot-metric__label">Confidence</span>
        <span className="analytics-snapshot-metric__value">{fmtPct(card.readConfidencePct)}</span>
      </div>
    </div>

    <div className="analytics-snapshot-card__secondary">
      <div>
        <span className="analytics-snapshot-stat__k">Exact reading</span>
        <span className="analytics-snapshot-stat__v">{fmtPct(card.exactReadingPct)}</span>
      </div>
      <div>
        <span className="analytics-snapshot-stat__k">Training images</span>
        <span className="analytics-snapshot-stat__v">{fmtNum(card.trainingImages)}</span>
      </div>
      {card.unitTestImages != null ? (
        <div>
          <span className="analytics-snapshot-stat__k">UT images</span>
          <span className="analytics-snapshot-stat__v">{fmtNum(card.unitTestImages)}</span>
        </div>
      ) : null}
    </div>

    {expanded ? (
      <div className="analytics-snapshot-card__details">
        <dl className="analytics-snapshot-detail-grid">
          {card.modelId !== '—' ? (
            <>
              <dt>Model ID</dt>
              <dd>{card.modelId}</dd>
            </>
          ) : null}
          {card.startDate ? (
            <>
              <dt>Started</dt>
              <dd>{card.startDate}</dd>
            </>
          ) : null}
          {card.status ? (
            <>
              <dt>Status</dt>
              <dd>{card.status}</dd>
            </>
          ) : null}
          {card.imagesAddedSinceLast != null ? (
            <>
              <dt>Images since last</dt>
              <dd>{fmtNum(card.imagesAddedSinceLast)}</dd>
            </>
          ) : null}
        </dl>
        {card.outcome ? (
          <p className="analytics-snapshot-card__outcome">
            <strong>Outcome:</strong> {card.outcome}
          </p>
        ) : null}
        <PerDialDonuts perDial={card.perDial} />
      </div>
    ) : (
      <PerDialDonuts perDial={card.perDial} compact />
    )}

    {(card.accuracyTrend.delta != null ||
      card.accuracyTrend.deltaVsFirst != null ||
      card.confidenceTrend.delta != null) && (
      <div className="analytics-snapshot-card__deltas">
        {card.accuracyTrend.previousIteration != null && card.accuracyTrend.delta != null ? (
          <DeltaPill
            label={`Acc vs #${card.accuracyTrend.previousIteration}`}
            delta={card.accuracyTrend.delta}
          />
        ) : null}
        {!latestPpOnly &&
        card.accuracyTrend.firstIteration != null &&
        card.accuracyTrend.firstIteration !== card.accuracyTrend.latestIteration &&
        card.accuracyTrend.deltaVsFirst != null ? (
          <DeltaPill
            label={`Program #${card.accuracyTrend.firstIteration}→#${card.accuracyTrend.latestIteration}`}
            delta={card.accuracyTrend.deltaVsFirst}
          />
        ) : null}
        {card.confidenceTrend.previousIteration != null && card.confidenceTrend.delta != null ? (
          <DeltaPill
            label={`Conf vs #${card.confidenceTrend.previousIteration}`}
            delta={card.confidenceTrend.delta}
          />
        ) : null}
      </div>
    )}

    {card.scopeNote ? <p className="analytics-snapshot-card__note">{card.scopeNote}</p> : null}
    {card.hasLinkedCsv ? (
      <p className="analytics-snapshot-card__source">
        Results: {card.linkedCsvName}
      </p>
    ) : null}
  </article>
);

type Props = {
  rows: PipelineIterationRecord[];
  pipelineFilter: ChartPipelineFilter;
  showReportCheckbox?: boolean;
  selectedReportIds?: Set<string>;
  onToggleReport?: (id: string) => void;
  /** Model trainer: latest iteration per pipeline, pp vs previous only. */
  latestScopeOnly?: boolean;
};

const DashboardProjectSnapshot: FC<Props> = ({
  rows,
  pipelineFilter,
  showReportCheckbox = false,
  selectedReportIds,
  onToggleReport,
  latestScopeOnly = false,
}) => {
  const singlePipeline = pipelineFilter !== 'all';
  const cards = useMemo(
    () => buildCurrentSnapshots(rows, pipelineFilter),
    [rows, pipelineFilter],
  );
  const scopeSummary = useMemo(
    () => buildCurrentScopeSummary(rows, pipelineFilter),
    [rows, pipelineFilter],
  );
  const showSingleLayout = singlePipeline || cards.length === 1;

  const isReportChecked = (id: string) => selectedReportIds?.has(id) ?? false;

  if (!cards.length) {
    return (
      <div className="analytics-empty-state">
        <p>No eval data yet</p>
        <span>Attach a unit test file to an iteration to populate current metrics.</span>
      </div>
    );
  }

  return (
    <div
      className={`analytics-current-layout${
        showSingleLayout ? ' analytics-current-layout--single-pipeline' : ''
      }`}
      data-report-capture="Current snapshot"
      data-report-section="Current"
    >
      <article className="analytics-summary-card analytics-summary-card--compact">
        <div className="analytics-summary-card__icon" aria-hidden>
          <Images size={22} strokeWidth={1.75} />
        </div>
        <div className="analytics-summary-card__body">
          <span className="analytics-summary-card__label">
            {showSingleLayout ? cards[0]?.label : 'Total training images'}
          </span>
          <span className="analytics-summary-card__value">
            {fmtNum(
              showSingleLayout ? cards[0]?.trainingImages : scopeSummary.totalTrainingImages,
            )}
          </span>
          <span className="analytics-summary-card__meta">
            Latest iteration · {scopeSummary.iterationCount} total in program
            {!showSingleLayout && scopeSummary.totalUnitTestImages != null
              ? ` · ${fmtNum(scopeSummary.totalUnitTestImages)} UT images`
              : showSingleLayout && cards[0]?.unitTestImages != null
                ? ` · ${fmtNum(cards[0].unitTestImages)} UT images`
                : ''}
          </span>
        </div>
      </article>

      <div className={showSingleLayout ? 'analytics-snapshot-single' : 'analytics-snapshot-grid'}>
        {cards.map((card) => (
          <SnapshotCard
            key={card.id}
            card={card}
            expanded={showSingleLayout}
            showReportCheckbox={showReportCheckbox}
            reportChecked={isReportChecked(card.id)}
            onReportToggle={onToggleReport}
            latestPpOnly={latestScopeOnly}
          />
        ))}
      </div>
    </div>
  );
};

export default DashboardProjectSnapshot;
