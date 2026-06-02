import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { fetchAuditEvents, type AuditEventRecord } from '../services/api';
import type { PortalWorkMode } from '../utils/portalWorkMode';
import AuditEventTimeline from './AuditEventTimeline';

type Props = {
  sessionId: string;
  portalWorkMode: PortalWorkMode;
};

const SessionActivitySection: React.FC<Props> = ({ sessionId, portalWorkMode }) => {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditEvents({ sessionId, limit: 100 }, portalWorkMode);
      setEvents(res.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, portalWorkMode]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="session-activity-section" aria-labelledby="session-activity-heading">
      <div className="session-activity-head">
        <h2 id="session-activity-heading">
          <Activity size={20} aria-hidden />
          Device activity
          {!loading && events.length > 0 ? (
            <span className="session-activity-count">({events.length})</span>
          ) : null}
        </h2>
        <button type="button" className="session-activity-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>
      <p className="session-activity-lead">
        Capture and upload steps from the iOS app for this session. Expand a row for full details.
      </p>
      {error ? (
        <p className="session-activity-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="session-activity-loading">
          <Loader2 size={18} className="spin" aria-hidden />
          Loading activity…
        </p>
      ) : (
        <AuditEventTimeline events={events} />
      )}
    </section>
  );
};

export default SessionActivitySection;
