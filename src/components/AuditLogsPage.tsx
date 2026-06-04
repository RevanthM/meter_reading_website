import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  ScrollText,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import AuditEventTimeline from './AuditEventTimeline';
import {
  fetchAuditEvents,
  fetchAuditLogSummary,
  type AuditEventRecord,
  type AuditSessionRow,
  type AuditLogSummary,
} from '../services/api';
import { calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';
import { auditActionLabel, formatAuditTs } from '../utils/auditEventDisplay';

function todayPortalDay(): string {
  return calendarDayKeyInPortalTz(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
}

function sessionStatusLabel(row: AuditSessionRow): string {
  if (row.uploadFailed) return 'Failed';
  if (row.uploadSucceeded) return 'Uploaded';
  if (row.uploadStarted) return 'Uploading';
  if (row.queued) return 'Queued';
  return '—';
}

const AuditLogsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isPortalAdmin } = useAuth();
  const isAdmin = isPortalAdmin;

  const [userNameFilter, setUserNameFilter] = useState('');
  const [from, setFrom] = useState(todayPortalDay);
  const [to, setTo] = useState(todayPortalDay);
  const [summary, setSummary] = useState<AuditLogSummary | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSession = useCallback(
    (sessionId: string, workType?: string | null) => {
      const wt = workType && /^\d{4}$/.test(workType) ? workType : '1000';
      navigate(`/reading/${encodeURIComponent(sessionId)}?workType=${wt}`);
    },
    [navigate],
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const filter = userNameFilter.trim() || undefined;
      const [sum, ev] = await Promise.all([
        fetchAuditLogSummary(from, to, 'admin', filter),
        fetchAuditEvents({ userName: filter, from, to, limit: 300 }, 'admin'),
      ]);
      setSummary(sum);
      setEvents(ev.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
      setSummary(null);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userNameFilter, from, to]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const sessions = useMemo(() => summary?.sessions ?? [], [summary]);

  if (!isAdmin) {
    return (
      <div className="activity-page audit-logs-page">
        <header className="page-header">
          <div className="header-content">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={18} />
              Back
            </button>
            <div className="page-title">
              <ScrollText size={28} strokeWidth={1.5} />
              <h1>Audit logs</h1>
            </div>
          </div>
        </header>
        <div className="activity-content">
          <p className="text-muted">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-page audit-logs-page">
      <header className="page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={18} />
              Back
            </button>
            <div className="page-title">
              <ScrollText size={28} strokeWidth={1.5} />
              <div>
                <h1>Audit logs</h1>
                <p>Device capture, upload, and portal admin events</p>
              </div>
            </div>
          </div>
          <ListPageRefreshButton
            busy={loading || refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        </div>
      </header>

      <div className="activity-content audit-logs-content">
        <div className="audit-logs-filters">
          <label>
            Collector
            <input
              type="text"
              value={userNameFilter}
              onChange={(e) => setUserNameFilter(e.target.value)}
              placeholder="Optional — filter by name or email"
              autoComplete="username"
            />
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {error && (
          <p className="audit-logs-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}

        {summary && !loading && (
          <>
            <p className="audit-logs-stats">
              <strong>{summary.eventCount}</strong> events · <strong>{summary.collectorCount}</strong>{' '}
              collector{summary.collectorCount === 1 ? '' : 's'} · <strong>{summary.uniqueSessions}</strong>{' '}
              session{summary.uniqueSessions === 1 ? '' : 's'}
              {userNameFilter.trim() ? ` · filtered: ${userNameFilter.trim()}` : ''}
            </p>

            <h2 className="audit-logs-section-title">Event log ({events.length})</h2>
            <AuditEventTimeline
              events={events}
              showSession
              onSessionClick={openSession}
              emptyMessage="No events in this range."
            />

            <h2 className="audit-logs-section-title">By session ({sessions.length})</h2>
            <div className="audit-logs-table-wrap">
              <table className="audit-logs-table audit-logs-table--clickable">
                <thead>
                  <tr>
                    <th>Last</th>
                    <th>Collector</th>
                    <th>Session</th>
                    <th>Status</th>
                    <th>Last action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No session activity in this range.</td>
                    </tr>
                  ) : (
                    sessions.map((row, i) => (
                      <tr
                        key={`${row.sessionId ?? ''}-${row.lastTs ?? ''}-${i}`}
                        className={row.sessionId ? 'audit-logs-row-clickable' : undefined}
                        onClick={() => {
                          if (row.sessionId) openSession(row.sessionId, row.workType);
                        }}
                      >
                        <td>{formatAuditTs(row.lastTs)}</td>
                        <td>{row.collector || '—'}</td>
                        <td className="audit-logs-mono">{row.sessionId || '—'}</td>
                        <td>
                          <span
                            className={`audit-logs-status audit-logs-status--${
                              row.uploadFailed ? 'fail' : row.uploadSucceeded ? 'ok' : 'pending'
                            }`}
                          >
                            {sessionStatusLabel(row)}
                          </span>
                        </td>
                        <td>
                          {row.lastAction ? auditActionLabel(row.lastAction) : '—'}
                          {row.lastError ? (
                            <span className="audit-logs-row-error" title={row.lastError}>
                              {' '}
                              · {row.lastError.slice(0, 48)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {loading && !summary && (
          <p className="audit-logs-loading">
            <Loader2 size={20} className="spin" />
            Loading audit logs…
          </p>
        )}
      </div>
    </div>
  );
};

export default AuditLogsPage;
