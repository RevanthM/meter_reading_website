import { useCallback, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft,
  Gauge,
  RefreshCw,
  Loader2,
  Smartphone,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import {
  fetchAuditEvents,
  fetchAuditSyncSummary,
  type AuditEventRecord,
  type AuditSyncSummary,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { calendarDayKeyInPortalTz } from '../utils/readingDisplayDates';

function todayPortalDay(): string {
  return calendarDayKeyInPortalTz(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

const SyncHealthPage: React.FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const workMode = outletCtx?.workMode ?? 'admin';
  const isAdmin = workMode === 'admin';

  const [userName, setUserName] = useState('');
  const [from, setFrom] = useState(todayPortalDay);
  const [to, setTo] = useState(todayPortalDay);
  const [summary, setSummary] = useState<AuditSyncSummary | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const name = userName.trim();
    if (!name) {
      setError('Enter a collector user name (same as iOS login).');
      setSummary(null);
      setEvents([]);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const [sum, ev] = await Promise.all([
        fetchAuditSyncSummary(name, from, to, workMode),
        fetchAuditEvents({ userName: name, from, to, limit: 200 }, workMode),
      ]);
      setSummary(sum);
      setEvents(ev.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sync health');
      setSummary(null);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userName, from, to, workMode]);

  if (!isAdmin) {
    return (
      <div className="activity-page sync-health-page">
        <header className="page-header">
          <div className="header-content">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={18} />
              Back
            </button>
            <div className="page-title">
              <Gauge size={28} strokeWidth={1.5} />
              <h1>Sync health</h1>
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
    <div className="activity-page sync-health-page">
      <header className="page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <button type="button" className="back-button" onClick={() => navigate('/')}>
              <ArrowLeft size={18} />
              Back
            </button>
            <div className="page-title">
              <Smartphone size={28} strokeWidth={1.5} />
              <div>
                <h1>Sync health</h1>
                <p>Device capture → upload vs portal sessions</p>
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

      <div className="activity-content sync-health-content">
        <div className="sync-health-filters">
          <label>
            Collector
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="iOS user name"
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
          <button
            type="button"
            className="sync-health-load-btn"
            disabled={loading || !userName.trim()}
            onClick={() => void load()}
          >
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Load
          </button>
        </div>

        {error && (
          <p className="sync-health-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}

        {summary && !loading && (
          <>
            <div className="sync-health-kpis">
              <div className="sync-health-kpi">
                <Upload size={18} />
                <span className="sync-health-kpi-value">{summary.queuedCount}</span>
                <span className="sync-health-kpi-label">Queued on device</span>
              </div>
              <div className="sync-health-kpi">
                <CheckCircle2 size={18} />
                <span className="sync-health-kpi-value">{summary.uploadSucceeded}</span>
                <span className="sync-health-kpi-label">Upload succeeded</span>
              </div>
              <div className="sync-health-kpi">
                <AlertTriangle size={18} />
                <span className="sync-health-kpi-value">{summary.uploadFailed}</span>
                <span className="sync-health-kpi-label">Upload failed</span>
              </div>
              <div className="sync-health-kpi">
                <Clock size={18} />
                <span className="sync-health-kpi-value">{summary.pendingUpload}</span>
                <span className="sync-health-kpi-label">Still pending</span>
              </div>
              <div className="sync-health-kpi">
                <Database size={18} />
                <span className="sync-health-kpi-value">{summary.portalSessionsInRange}</span>
                <span className="sync-health-kpi-label">Portal sessions (range)</span>
              </div>
              <div className="sync-health-kpi sync-health-kpi-gap">
                <span className="sync-health-kpi-value">{summary.gapVsPortal}</span>
                <span className="sync-health-kpi-label">Gap (queued − portal)</span>
              </div>
            </div>

            {summary.lastBatch && (
              <p className="sync-health-meta">
                Last sync batch {formatTs(summary.lastBatch.ts)} — uploaded{' '}
                {summary.lastBatch.uploaded ?? '—'}, failed {summary.lastBatch.failed ?? '—'} ·{' '}
                {summary.eventCount} audit events
              </p>
            )}

            <h2 className="sync-health-section-title">Sessions ({summary.sessions.length})</h2>
            <div className="sync-health-table-wrap">
              <table className="sync-health-table">
                <thead>
                  <tr>
                    <th>Last</th>
                    <th>Session</th>
                    <th>Queued</th>
                    <th>Started</th>
                    <th>OK</th>
                    <th>Failed</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No audit events for this collector and date range.</td>
                    </tr>
                  ) : (
                    summary.sessions.map((row, i) => (
                      <tr key={`${row.sessionId ?? ''}-${row.lastTs ?? ''}-${i}`}>
                        <td>{formatTs(row.lastTs)}</td>
                        <td className="sync-health-mono">{row.sessionId || '—'}</td>
                        <td>{row.queued ? '✓' : ''}</td>
                        <td>{row.uploadStarted ? '✓' : ''}</td>
                        <td>{row.uploadSucceeded ? '✓' : ''}</td>
                        <td>{row.uploadFailed ? '✓' : ''}</td>
                        <td>
                          {row.lastAction || '—'}
                          {row.lastError ? (
                            <span className="sync-health-row-error" title={row.lastError}>
                              {' '}
                              · {row.lastError.slice(0, 60)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h2 className="sync-health-section-title">Recent events ({events.length})</h2>
            <div className="sync-health-table-wrap">
              <table className="sync-health-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Session</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{formatTs(e.ts)}</td>
                      <td>{e.action}</td>
                      <td className="sync-health-mono">{e.target?.sessionId || '—'}</td>
                      <td>{e.outcome}{e.error ? ` · ${e.error.slice(0, 40)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {loading && !summary && (
          <p className="sync-health-loading">
            <Loader2 size={20} className="spin" />
            Loading…
          </p>
        )}
      </div>
    </div>
  );
};

export default SyncHealthPage;
