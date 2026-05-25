import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Edit3,
  Inbox,
  Loader2,
  User,
  XCircle,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import TestDataPendingLightbox from './TestDataPendingLightbox';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import { approveSessionForUnitTest, removeSessionFromTestDataset, type ImageDifficulty, type S3MeterReading } from '../services/api';
import type { WorkType } from '../types';
import { confirmRemoveFromTestDataset } from '../utils/testDataRemoveConfirm';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canEditTestData, canViewTestData } from '../utils/portalWorkMode';
import { formatReadingShortDate } from '../utils/readingDisplayDates';
import { formatSessionIdForDisplay } from '../utils/sessionDisplay';
import { primaryMeterImageUrl } from '../utils/meterImagePartition';
import { formatUnitTestDifficultyTag, normalizeUnitTestDifficulty } from '../utils/unitTestImageNaming';
import {
  formatSubmitterLabel,
  matchesSubmittedDatePreset,
  testDataSubmittedAtIso,
  testDataSubmittedBy,
  type SubmittedDatePreset,
} from '../utils/testDataSubmission';
import { formatPresetLabel, type DateRangePresetId } from '../utils/dateRangePresets';

type PendingDifficultyFilter = 'all' | Exclude<ImageDifficulty, null>;
type SortOrder = 'submitted_desc' | 'submitted_asc' | 'capture_desc';

const DATE_PRESETS: SubmittedDatePreset[] = ['all', 'today', 'yesterday', 'last7', 'last30'];

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

function sortTimestamp(r: S3MeterReading, mode: SortOrder): number {
  if (mode === 'capture_desc') {
    return Date.parse(r.dateOfReading) || 0;
  }
  return Date.parse(testDataSubmittedAtIso(r) ?? '') || Date.parse(r.dateOfReading) || 0;
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
  const [sentByFilter, setSentByFilter] = useState<string>('all');
  const [datePreset, setDatePreset] = useState<SubmittedDatePreset>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('submitted_desc');

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
    const mode = outletCtx?.workMode;
    if (!mode || !canViewTestData(mode)) {
      navigate('/', { replace: true });
      return;
    }
    void ensureReadingsLoaded();
  }, [ensureReadingsLoaded, navigate, outletCtx?.workMode]);

  const canEdit = outletCtx?.workMode ? canEditTestData(outletCtx.workMode) : false;

  const pending = useMemo(
    () => filteredReadings.filter(isPendingTestData).filter((r) => !removedIds.has(r.id)),
    [filteredReadings, removedIds],
  );

  const submitterOptions = useMemo(() => {
    const emails = new Set<string>();
    for (const r of pending) {
      const who = testDataSubmittedBy(r);
      if (who) emails.add(who);
    }
    return [...emails].sort((a, b) => a.localeCompare(b));
  }, [pending]);

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
    let list = pending.filter((r) => {
      if (difficultyFilter !== 'all' && normalizeUnitTestDifficulty(r.imageDifficulty) !== difficultyFilter) {
        return false;
      }
      if (sentByFilter !== 'all') {
        const who = testDataSubmittedBy(r);
        if (who !== sentByFilter) return false;
      }
      if (!matchesSubmittedDatePreset(r, datePreset)) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      const ta = sortTimestamp(a, sortOrder);
      const tb = sortTimestamp(b, sortOrder);
      if (sortOrder === 'submitted_asc') return ta - tb;
      return tb - ta;
    });
    return list;
  }, [pending, difficultyFilter, sentByFilter, datePreset, sortOrder]);

  const activeFilterCount = [
    difficultyFilter !== 'all',
    sentByFilter !== 'all',
    datePreset !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDifficultyFilter('all');
    setSentByFilter('all');
    setDatePreset('all');
  };

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
          outletCtx?.workMode ?? 'test_data_reviewer',
        );
        markRemoved(r.id);
        window.alert(`Approved — ${res.fileName} added to unit test images.`);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Approve failed');
      } finally {
        setApprovingId(null);
      }
    },
    [markRemoved, outletCtx?.workMode, userEmail, workType],
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
          outletCtx?.workMode ?? 'test_data_reviewer',
        );
        markRemoved(r.id);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setRemovingId(null);
      }
    },
    [markRemoved, outletCtx?.workMode, userEmail, workType],
  );

  const handleReadingUpdated = useCallback(
    (reading: S3MeterReading) => {
      upsertReading(reading);
    },
    [upsertReading],
  );

  const lightboxItem = lightboxIndex != null ? visiblePending[lightboxIndex] : undefined;
  const lightboxUrl = lightboxItem ? primaryMeterImageUrl(lightboxItem.images) : null;

  const headerSummary =
    readingsLoading || refreshing
      ? 'Loading…'
      : activeFilterCount > 0 || visiblePending.length !== pending.length
        ? `${visiblePending.length} of ${pending.length} session${pending.length === 1 ? '' : 's'} (${workType})`
        : `${pending.length} session${pending.length === 1 ? '' : 's'} awaiting review (${workType})`;

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
                <p>{headerSummary}</p>
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
        <section className="test-data-pending-toolbar" aria-label="Filter pending test data">
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

          <div className="test-data-pending-filter-row">
            <label className="test-data-pending-filter">
              <span className="test-data-pending-filter-label">Sent by</span>
              <select value={sentByFilter} onChange={(e) => setSentByFilter(e.target.value)}>
                <option value="all">All reviewers</option>
                {submitterOptions.map((email) => (
                  <option key={email} value={email}>
                    {formatSubmitterLabel(email)}
                  </option>
                ))}
              </select>
            </label>

            <label className="test-data-pending-filter">
              <span className="test-data-pending-filter-label">Sent date</span>
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as SubmittedDatePreset)}
              >
                {DATE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset === 'all' ? 'Any time' : formatPresetLabel(preset as DateRangePresetId)}
                  </option>
                ))}
              </select>
            </label>

            <label className="test-data-pending-filter">
              <span className="test-data-pending-filter-label">Sort</span>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)}>
                <option value="submitted_desc">Newest sent first</option>
                <option value="submitted_asc">Oldest sent first</option>
                <option value="capture_desc">Newest capture first</option>
              </select>
            </label>

            {activeFilterCount > 0 ? (
              <button type="button" className="test-data-pending-clear-filters" onClick={clearFilters}>
                Clear filters ({activeFilterCount})
              </button>
            ) : null}

            <button
              type="button"
              className="test-data-pending-sort-toggle"
              title={sortOrder === 'submitted_asc' ? 'Switch to newest first' : 'Switch to oldest first'}
              aria-label="Toggle sent-date sort direction"
              onClick={() =>
                setSortOrder((prev) =>
                  prev === 'submitted_asc' ? 'submitted_desc' : prev === 'submitted_desc' ? 'submitted_asc' : prev,
                )
              }
              disabled={sortOrder === 'capture_desc'}
            >
              {sortOrder === 'submitted_asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>
        </section>
      ) : null}

      {!readingsLoading && pending.length > 0 && visiblePending.length === 0 ? (
        <p className="pipeline-iterations-empty test-data-pending-empty">
          No sessions match the current filters.
          {activeFilterCount > 0 ? (
            <>
              {' '}
              <button type="button" className="test-data-pending-clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {!readingsLoading && visiblePending.length > 0 ? (
        <div className="unit-test-images-grid test-data-pending-grid">
          {visiblePending.map((r, index) => {
            const busy = removingId === r.id || approvingId === r.id;
            const thumbUrl = primaryMeterImageUrl(r.images);
            const difficulty = r.imageDifficulty || 'normal';
            const expected = r.expectedValue ?? r.meterValue ?? '—';
            const submitter = testDataSubmittedBy(r);
            const submittedAt = testDataSubmittedAtIso(r);
            const notesPreview = r.comments?.trim();

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
                <p className="test-data-pending-card-meta">
                  <User size={14} aria-hidden />
                  {submitter ? (
                    <span title={submitter}>Sent by {formatSubmitterLabel(submitter)}</span>
                  ) : (
                    <span className="test-data-pending-card-meta-muted">Sent by unknown</span>
                  )}
                </p>
                <p className="test-data-pending-card-date">
                  <Calendar size={14} aria-hidden />
                  {submittedAt
                    ? `Sent ${formatReadingShortDate(submittedAt)}`
                    : `Captured ${formatReadingShortDate(r.dateOfReading)}`}
                </p>
                {notesPreview ? (
                  <p className="test-data-pending-card-notes" title={notesPreview}>
                    {notesPreview.length > 72 ? `${notesPreview.slice(0, 72)}…` : notesPreview}
                  </p>
                ) : null}

                <div className="unit-test-images-card-actions test-data-pending-card-actions">
                  <button
                    type="button"
                    className="view-button test-data-pending-edit-btn"
                    disabled={busy || !thumbUrl}
                    onClick={() => openLightbox(index)}
                  >
                    <Edit3 size={16} aria-hidden />
                    {canEdit ? 'Edit' : 'View'}
                  </button>
                  {canEdit ? (
                    <>
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
                    </>
                  ) : null}
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
          readOnly={!canEdit}
          portalWorkMode={outletCtx?.workMode ?? 'test_data_reviewer'}
        />
      ) : null}
    </div>
  );
};

export default TestDataPendingPage;
