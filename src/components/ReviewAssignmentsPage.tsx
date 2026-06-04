import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ClipboardList, Loader2, Users } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import {
  createReviewAssignment,
  fetchReviewAssignments,
  previewReviewAssignment,
  updateReviewAssignmentBatch,
  type ReviewAssignmentPool,
  type ReviewAssignmentRules,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';

const POOL_OPTIONS: { id: ReviewAssignmentPool; label: string }[] = [
  { id: 'field_test', label: 'Field test' },
  { id: 'awaiting_review', label: 'Awaiting review' },
];

const ReviewAssignmentsPage: FC = () => {
  const navigate = useNavigate();
  const { userEmail, isPortalAdmin } = useAuth();
  const { workType } = useReadings();
  const isAdmin = isPortalAdmin;

  const [name, setName] = useState('');
  const [pool, setPool] = useState<ReviewAssignmentPool>('field_test');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [firstN, setFirstN] = useState(50);
  const [corrected, setCorrected] = useState<'all' | 'yes' | 'no'>('all');
  const [cohort, setCohort] = useState('untrained');
  const [assigneesRaw, setAssigneesRaw] = useState('');
  const [preview, setPreview] = useState<{
    totalInPool: number;
    totalMatching: number;
    willAssign: number;
    excludedAlreadyAssigned: number;
    splitPreview: { assigneeEmail: string; count: number }[];
  } | null>(null);
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof fetchReviewAssignments>>['batches']>([]);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rules: ReviewAssignmentRules = useMemo(
    () => ({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      firstN,
      corrected,
      cohort,
      sort: 'date_asc',
    }),
    [dateFrom, dateTo, firstN, corrected, cohort],
  );

  const assignees = useMemo(
    () =>
      assigneesRaw
        .split(/[\n,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    [assigneesRaw],
  );

  const loadBatches = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReviewAssignments(workType, undefined, 'admin', userEmail ?? undefined);
      setBatches(res.batches);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assignments');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, workType, userEmail]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await previewReviewAssignment(
        { workType, pool, rules, assignees, splitMode: 'equal' },
        'admin',
        userEmail ?? undefined,
      );
      setPreview({
        totalInPool: res.totalInPool,
        totalMatching: res.totalMatching,
        willAssign: res.willAssign,
        excludedAlreadyAssigned: res.excludedAlreadyAssigned,
        splitPreview: res.splitPreview,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const runCreate = async () => {
    if (!name.trim()) {
      setError('Enter a batch name');
      return;
    }
    if (assignees.length === 0) {
      setError('Enter at least one reviewer email');
      return;
    }
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await createReviewAssignment(
        {
          workType,
          pool,
          name: name.trim(),
          rules,
          assignees,
          splitMode: 'equal',
        },
        'admin',
        userEmail ?? undefined,
      );
      setMessage(
        `Created "${res.batch.name}" — ${res.batch.totalAssigned} assigned` +
          (res.errors.length ? ` (${res.errors.length} errors)` : ''),
      );
      setPreview(null);
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const closeBatch = async (batchId: string) => {
    try {
      await updateReviewAssignmentBatch(batchId, workType, 'closed', 'admin', userEmail ?? undefined);
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close batch');
    }
  };

  if (!isAdmin) {
    return (
      <div className="activity-page review-assignments-page">
        <header className="page-header">
          <div className="page-title">
            <ClipboardList size={28} strokeWidth={1.5} />
            <h1>Review assignments</h1>
          </div>
        </header>
        <div className="activity-content">
          <p className="text-muted">
            Admin access required. Sign in with a <code>saireetika*</code> account or an admin role, then
            hard-refresh. Signed in as: {userEmail || 'unknown'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-page review-assignments-page">
      <header className="page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={18} />
              Back
            </button>
            <div className="page-title">
              <ClipboardList size={28} strokeWidth={1.5} />
              <div>
                <h1>Review assignments</h1>
                <p>Field test and awaiting review — assign by date or first N</p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton busy={loading} onRefresh={() => void loadBatches()} />
        </div>
      </header>

      <div className="activity-content review-assignments-content">
        {error ? (
          <p className="dashboard-error" role="alert">
            <AlertTriangle size={18} aria-hidden /> {error}
          </p>
        ) : null}
        {message ? (
          <p className="review-assignments-message" role="status">
            {message}
          </p>
        ) : null}

        <section className="dashboard-section">
          <h2 className="section-title">Create batch</h2>
          <div className="review-assignments-filters audit-logs-filters">
            <label>
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="May field test sprint"
              />
            </label>
            <label>
              Pool
              <select
                className="readings-list-filter-select"
                value={pool}
                onChange={(e) => setPool(e.target.value as ReviewAssignmentPool)}
              >
                {POOL_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date from
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              Date to
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label>
              First N
              <input
                type="number"
                min={0}
                max={2000}
                value={firstN}
                onChange={(e) => setFirstN(Math.max(0, parseInt(e.target.value, 10) || 0))}
                title="0 = all matching"
              />
            </label>
            <label>
              Corrected
              <select
                className="readings-list-filter-select"
                value={corrected}
                onChange={(e) => setCorrected(e.target.value as 'all' | 'yes' | 'no')}
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label>
              Cohort
              <select
                className="readings-list-filter-select"
                value={cohort}
                onChange={(e) => setCohort(e.target.value)}
              >
                <option value="untrained">Awaiting review</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="review-assignments-assignees-field">
              Reviewer emails
              <textarea
                rows={2}
                value={assigneesRaw}
                onChange={(e) => setAssigneesRaw(e.target.value)}
                placeholder="reviewer1@example.com, reviewer2@example.com"
              />
            </label>
          </div>
          <div className="review-assignments-actions">
            <button type="button" className="audit-logs-load-btn" disabled={previewing} onClick={() => void runPreview()}>
              {previewing ? <Loader2 size={16} className="spin" /> : null}
              Preview
            </button>
            <button type="button" className="audit-logs-load-btn" disabled={creating} onClick={() => void runCreate()}>
              {creating ? <Loader2 size={16} className="spin" /> : null}
              Create assignment
            </button>
          </div>
          {preview ? (
            <div className="review-assignments-preview">
              <p>
                <strong>{preview.totalInPool}</strong> in pool
                {preview.totalInPool !== preview.totalMatching ? (
                  <>
                    {' '}
                    · <strong>{preview.totalMatching}</strong> match filters
                  </>
                ) : null}{' '}
                · assign <strong>{preview.willAssign}</strong>
                {preview.excludedAlreadyAssigned > 0
                  ? ` · ${preview.excludedAlreadyAssigned} already in open batches`
                  : ''}
              </p>
              {preview.totalInPool === 0 ? (
                <p className="review-assignments-preview-hint">
                  No sessions in this pool for work type {workType}. Try another pool, clear date filters, or confirm
                  Dynamo has awaiting-review rows.
                </p>
              ) : preview.totalMatching === 0 ? (
                <p className="review-assignments-preview-hint">
                  Pool has sessions but none match your date/cohort filters. Widen the date range or set Cohort to All.
                </p>
              ) : null}
              {preview.splitPreview.length > 0 ? (
                <ul>
                  {preview.splitPreview.map((s) => (
                    <li key={s.assigneeEmail}>
                      <Users size={14} aria-hidden /> {s.assigneeEmail}: {s.count}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="dashboard-section">
          <h2 className="section-title">Batches</h2>
        {loading ? (
          <p>
            <Loader2 size={18} className="spin" aria-hidden /> Loading…
          </p>
        ) : batches.length === 0 ? (
          <p>No assignment batches yet.</p>
        ) : (
          <div className="readings-table-container">
          <table className="readings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pool</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.pool === 'field_test' ? 'Field test' : 'Awaiting review'}</td>
                  <td>{b.status}</td>
                  <td>{b.totalAssigned}</td>
                  <td>
                    {b.assignees.map((a) => (
                      <div key={a.email} className="review-assignments-progress-line">
                        {a.email}: {a.reviewed ?? 0}/{a.count}
                        {a.remaining != null ? ` (${a.remaining} left)` : ''}
                      </div>
                    ))}
                  </td>
                  <td>
                    {b.status === 'open' ? (
                      <button type="button" className="view-button" onClick={() => void closeBatch(b.id)}>
                        Close
                      </button>
                    ) : (
                      '—'
                    )}
                    <button
                      type="button"
                      className="view-button"
                      onClick={() =>
                        navigate(
                          b.pool === 'field_test'
                            ? '/field-test?assign=me'
                            : '/readings/incorrect_new?assign=me',
                        )
                      }
                    >
                      Open pool
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        </section>
      </div>
    </div>
  );
};

export default ReviewAssignmentsPage;
