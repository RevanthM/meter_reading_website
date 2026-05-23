import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Calendar, CheckCircle2, Edit3, Inbox, Loader2, XCircle } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import TestDataPendingLightbox from './TestDataPendingLightbox';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import { approveSessionForUnitTest, removeSessionFromTestDataset, type ImageDifficulty, type S3MeterReading } from '../services/api';
import type { WorkType } from '../types';
import { confirmRemoveFromTestDataset } from '../utils/testDataRemoveConfirm';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { formatReadingShortDate } from '../utils/readingDisplayDates';
import { formatSessionIdForDisplay } from '../utils/sessionDisplay';
import { primaryMeterImageUrl } from '../utils/meterImagePartition';
import { formatUnitTestDifficultyTag, normalizeUnitTestDifficulty } from '../utils/unitTestImageNaming';

type PendingDifficultyFilter = 'all' | Exclude<ImageDifficulty, null>;

const DIFFICULTY_FILTERS: { id: PendingDifficultyFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'normal', label: 'Normal' },
  { id: 'difficult', label: 'Difficult' },
  { id: 'very_difficult', label: 'Very difficult' },
];

function isPendingTestData(r: S3MeterReading): boolean {
  return r.reviewerDatasetDestination === 'test' && r.testDataReviewStatus !== 'approved';
}

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

function adjustLightboxIndexAfterRemove(
  lb: number | null,
  removedIdx: number,
  nextLen: number,
): number | null {
  if (lb == null) return null;
  if (nextLen <= 0) return null;
  if (removedIdx < 0) return lb;
  if (lb > removedIdx) return lb - 1;
  if (lb === removedIdx) return Math.min(lb, nextLen - 1);
  return lb;
}

const TestDataPendingPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { userEmail } = useAuth();
  const { filteredReadings, ensureReadingsLoaded, readingsLoading, workType, refreshData, upsertReading } =
    useReadings();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [difficultyFilter, setDifficultyFilter] = useState<PendingDifficultyFilter>('all');

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
      setRemovedIds(new Set());
    } finally {
      setRefreshing(false);
    }
  }, [refreshData]);

  useEffect(() => {
    if (outletCtx?.workMode !== 'test_data_reviewer') {
      navigate('/', { replace: true });
      return;
    }
    void ensureReadingsLoaded();
  }, [ensureReadingsLoaded, navigate, outletCtx?.workMode]);

  const pending = useMemo(
    () => filteredReadings.filter(isPendingTestData).filter((r) => !removedIds.has(r.id)),
    [filteredReadings, removedIds],
  );

  const difficultyCounts = useMemo(() => {
    const counts: Record<PendingDifficultyFilter, number> = {
      all: pending.length,
      normal: 0,
      difficult: 0,
      very_difficult: 0,
    };
    for (const r of pending) {
      const d = normalizeUnitTestDifficulty(r.imageDifficulty);
      counts[d] += 1;
    }
    return counts;
  }, [pending]);

  const visiblePending = useMemo(() => {
    if (difficultyFilter === 'all') return pending;
    return pending.filter((r) => normalizeUnitTestDifficulty(r.imageDifficulty) === difficultyFilter);
  }, [pending, difficultyFilter]);

  useEffect(() => {
    setLightboxIndex((lb) => {
      if (lb == null) return lb;
      if (lb >= visiblePending.length) return visiblePending.length > 0 ? visiblePending.length - 1 : null;
      return lb;
    });
  }, [visiblePending.length]);

  const openLightbox = (index: number) => {
    if (!primaryMeterImageUrl(visiblePending[index]?.images)) return;
    setLightboxIndex(index);
  };

  const markRemoved = useCallback(
    (sessionId: string) => {
      const removedIdx = pending.findIndex((r) => r.id === sessionId);
      setRemovedIds((prev) => new Set(prev).add(sessionId));
      setLightboxIndex((lb) => adjustLightboxIndexAfterRemove(lb, removedIdx, pending.length - 1));
      void refreshData();
    },
    [pending, refreshData],
  );

  const handleQuickApprove = useCallback(
    async (r: S3MeterReading) => {
      if (!r.s3SessionPrefix) {
        window.alert('Session folder prefix is missing; cannot approve.');
        return;
      }
      const expected = (r.expectedValue ?? r.meterValue ?? '').trim() || '—';
      if (
        !window.confirm(
          `Approve for unit test library?\n\nSession: ${formatSessionIdForDisplay(r.id)}\nExpected reading: ${expected}`,
        )
      ) {
        return;
      }
      setApprovingId(r.id);
      try {
        const res = await approveSessionForUnitTest(
          r.id,
          (r.workType || workType) as WorkType,
          userEmail || undefined,
          r.s3SessionPrefix,
        );
        markRemoved(r.id);
        window.alert(`Approved — ${res.fileName} added to unit test images.`);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Approve failed');
      } finally {
        setApprovingId(null);
      }
    },
    [markRemoved, userEmail, workType],
  );

  const handleQuickReject = useCallback(
    async (r: S3MeterReading) => {
      if (!r.s3SessionPrefix) {
        window.alert('Session folder prefix is missing; cannot update metadata.');
        return;
      }
      if (!confirmRemoveFromTestDataset(r)) return;
      setRemovingId(r.id);
      try {
        await removeSessionFromTestDataset(
          r.id,
          (r.workType || workType) as WorkType,
          userEmail || undefined,
          r.s3SessionPrefix,
        );
        markRemoved(r.id);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setRemovingId(null);
      }
    },
    [markRemoved, userEmail, workType],
  );

  const handleReadingUpdated = useCallback(
    (reading: S3MeterReading) => {
      upsertReading(reading);
    },
    [upsertReading],
  );

  const lightboxItem = lightboxIndex != null ? visiblePending[lightboxIndex] : undefined;
  const lightboxUrl = lightboxItem ? primaryMeterImageUrl(lightboxItem.images) : null;

  return (
    <div className="readings-list-page test-data-pending-page">
      <header className="page-header">
        <div className="header-content test-data-pending-header list-page-header-with-actions">
          <div className="test-data-pending-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={20} />
              <span>Back</span>
            </button>
            <div className="page-title">
              <Inbox size={32} strokeWidth={1.5} />
              <div>
                <h1>Pending test data</h1>
                <p>
                  {readingsLoading || refreshing
                    ? 'Loading…'
                    : difficultyFilter === 'all'
                      ? `${pending.length} session${pending.length === 1 ? '' : 's'} awaiting review (${workType})`
                      : `${visiblePending.length} of ${pending.length} session${pending.length === 1 ? '' : 's'} · ${formatUnitTestDifficultyTag(difficultyFilter)} (${workType})`}
                </p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton
            onRefresh={() => void handleRefresh()}
            busy={refreshing || readingsLoading}
            disabled={readingsLoading}
            title="Reload pending sessions from S3"
          />
        </div>
      </header>

      {readingsLoading && pending.length === 0 ? (
        <ListViewLoading message="Loading pending sessions…" />
      ) : null}
      {readingsLoading && pending.length > 0 ? (
        <ListViewLoading variant="inline" message="Refreshing sessions…" />
      ) : null}

      {!readingsLoading && pending.length === 0 ? (
        <p className="pipeline-iterations-empty test-data-pending-empty">
          No pending test-data sessions for this work type.
        </p>
      ) : null}

      {!readingsLoading && pending.length > 0 ? (
        <div className="test-data-pending-toolbar">
          <div className="test-data-pending-difficulty-filter" role="group" aria-label="Filter by difficulty">
            <span className="test-data-pending-difficulty-filter-label">Difficulty</span>
            {DIFFICULTY_FILTERS.map((f) => {
              const active = difficultyFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`test-data-pending-difficulty-filter-btn${active ? ' test-data-pending-difficulty-filter-btn--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setDifficultyFilter(f.id)}
                >
                  {f.id !== 'all' ? (
                    <span
                      className={`test-data-pending-difficulty-filter-dot ${difficultyBadgeClass(f.id)}`}
                      aria-hidden
                    />
                  ) : null}
                  {f.label}
                  <span className="test-data-pending-difficulty-filter-count">{difficultyCounts[f.id]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {!readingsLoading && pending.length > 0 && visiblePending.length === 0 ? (
        <p className="pipeline-iterations-empty test-data-pending-empty">
          No sessions match this difficulty filter.
        </p>
      ) : null}

      {!readingsLoading && visiblePending.length > 0 ? (
        <div className="unit-test-images-grid test-data-pending-grid">
          {visiblePending.map((r, index) => {
            const busy = removingId === r.id || approvingId === r.id;
            const thumbUrl = primaryMeterImageUrl(r.images);
            const difficulty = r.imageDifficulty || 'normal';
            const expected = r.expectedValue ?? r.meterValue ?? '—';

            return (
              <article key={r.id} className="unit-test-images-card test-data-pending-card">
                {thumbUrl ? (
                  <button
                    type="button"
                    className="unit-test-images-thumb-btn"
                    onClick={() => openLightbox(index)}
                    aria-label={`Review ${formatSessionIdForDisplay(r.id)}`}
                  >
                    <img src={thumbUrl} alt="" className="unit-test-images-thumb" loading="lazy" />
                  </button>
                ) : (
                  <div className="unit-test-images-thumb unit-test-images-thumb--empty">No preview</div>
                )}

                <div className="unit-test-images-card-head">
                  <span className={difficultyBadgeClass(difficulty)}>
                    {formatUnitTestDifficultyTag(difficulty)}
                  </span>
                </div>

                <p className="unit-test-images-name test-data-pending-session-name">
                  <code title={r.id}>{formatSessionIdForDisplay(r.id)}</code>
                </p>
                <p className="unit-test-images-expected">
                  Expected: <strong>{expected}</strong>
                </p>
                <p className="test-data-pending-card-date">
                  <Calendar size={14} aria-hidden />
                  {formatReadingShortDate(r.dateOfReading)}
                </p>

                <div className="unit-test-images-card-actions test-data-pending-card-actions">
                  <button
                    type="button"
                    className="view-button test-data-pending-edit-btn"
                    disabled={busy || !thumbUrl}
                    onClick={() => openLightbox(index)}
                  >
                    <Edit3 size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="reading-detail-tdr-approve-btn test-data-pending-approve-btn"
                    disabled={busy || r.reviewerDatasetDestination !== 'test'}
                    onClick={() => void handleQuickApprove(r)}
                  >
                    {approvingId === r.id ? (
                      <Loader2 size={16} className="spin" aria-hidden />
                    ) : (
                      <CheckCircle2 size={16} aria-hidden />
                    )}
                    Approve
                  </button>
                  <button
                    type="button"
                    className="test-data-remove-btn"
                    disabled={busy}
                    onClick={() => void handleQuickReject(r)}
                  >
                    {removingId === r.id ? (
                      <Loader2 size={16} className="spin" aria-hidden />
                    ) : (
                      <XCircle size={16} aria-hidden />
                    )}
                    Reject
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {lightboxIndex != null && lightboxItem && lightboxUrl ? (
        <TestDataPendingLightbox
          workType={workType}
          items={visiblePending}
          index={lightboxIndex}
          imageUrl={lightboxUrl}
          userEmail={userEmail || undefined}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onReadingUpdated={handleReadingUpdated}
          onReadingRemoved={markRemoved}
          onReadingApproved={markRemoved}
        />
      ) : null}
    </div>
  );
};

export default TestDataPendingPage;
