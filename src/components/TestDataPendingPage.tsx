import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Calendar, Eye, Inbox, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useReadings } from '../context/ReadingsContext';
import { useAuth } from '../context/AuthContext';
import { removeSessionFromTestDataset } from '../services/api';
import type { WorkType } from '../types';
import { confirmRemoveFromTestDataset } from '../utils/testDataRemoveConfirm';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import type { S3MeterReading } from '../services/api';
import { formatReadingShortDate } from '../utils/readingDisplayDates';
import { formatImageDifficultyLabel, formatSessionIdForDisplay } from '../utils/sessionDisplay';

function isPendingTestData(r: S3MeterReading): boolean {
  return r.reviewerDatasetDestination === 'test' && r.testDataReviewStatus !== 'approved';
}

const TestDataPendingPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { userEmail } = useAuth();
  const { filteredReadings, ensureReadingsLoaded, readingsLoading, workType, refreshData } = useReadings();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
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
    () => filteredReadings.filter(isPendingTestData),
    [filteredReadings],
  );

  const openReading = useCallback(
    (r: S3MeterReading) => {
      navigate(`/reading/${encodeURIComponent(r.id)}?workType=${encodeURIComponent(r.workType || workType)}`, {
        state: {
          readingQueueIds: pending.map((x) => x.id),
          listReturn: { pathname: '/test-data/pending' },
        },
      });
    },
    [navigate, pending, workType],
  );

  const handleRemoveFromTestDataset = useCallback(
    async (r: S3MeterReading) => {
      if (!r.s3SessionPrefix) {
        window.alert('Session folder prefix is missing; cannot update metadata.');
        return;
      }
      if (!confirmRemoveFromTestDataset(r)) {
        return;
      }
      setRemovingId(r.id);
      try {
        await removeSessionFromTestDataset(
          r.id,
          (r.workType || workType) as WorkType,
          userEmail || undefined,
          r.s3SessionPrefix,
        );
        await refreshData();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Remove from test dataset failed');
      } finally {
        setRemovingId(null);
      }
    },
    [refreshData, userEmail, workType],
  );

  return (
    <div className="readings-list-page">
      <header className="page-header">
        <div className="header-content test-data-pending-header">
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
                    : `${pending.length} session${pending.length === 1 ? '' : 's'} marked send to test dataset (${workType})`}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="view-button test-data-pending-refresh-btn"
            onClick={() => void handleRefresh()}
            disabled={readingsLoading || refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw size={16} className={refreshing || readingsLoading ? 'spin' : ''} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      <main className="list-content">
        <div className="table-container">
          {readingsLoading ? (
            <p className="training-pipeline-bar-hint">
              <Loader2 size={18} className="spin" /> Loading sessions…
            </p>
          ) : null}

          {!readingsLoading && pending.length === 0 ? (
            <div className="empty-state">
              <p>No pending test-data sessions for this work type.</p>
            </div>
          ) : null}

          {!readingsLoading && pending.length > 0 ? (
            <table className="readings-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th className="readings-th-meter-value">Expected reading</th>
                  <th>Difficulty</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => {
                  const busy = removingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="test-data-pending-session" title={r.id}>
                          {formatSessionIdForDisplay(r.id)}
                        </span>
                      </td>
                      <td className="readings-td-meter-value">
                        <span className="meter-value">{r.expectedValue ?? r.meterValue ?? '—'}</span>
                      </td>
                      <td>{formatImageDifficultyLabel(r.imageDifficulty)}</td>
                      <td>
                        <div className="cell-with-icon">
                          <Calendar size={16} className="cell-icon" aria-hidden />
                          <span>{formatReadingShortDate(r.dateOfReading)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="test-data-pending-actions">
                          <button
                            type="button"
                            className="view-button"
                            disabled={busy}
                            onClick={() => openReading(r)}
                          >
                            <Eye size={16} aria-hidden />
                            <span>Review</span>
                          </button>
                          <button
                            type="button"
                            className="test-data-remove-btn"
                            disabled={busy}
                            onClick={() => void handleRemoveFromTestDataset(r)}
                          >
                            {busy ? (
                              <Loader2 size={16} className="spin" aria-hidden />
                            ) : (
                              <XCircle size={16} aria-hidden />
                            )}
                            <span>Remove from test dataset</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </main>
    </div>
  );
};

export default TestDataPendingPage;
