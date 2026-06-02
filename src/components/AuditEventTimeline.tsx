import { useState } from 'react';
import { ChevronDown, ChevronRight, User } from 'lucide-react';
import type { AuditEventRecord } from '../services/api';
import {
  auditActionLabel,
  auditActorLabel,
  auditDetailEntries,
  auditOutcomeTone,
  formatAuditTs,
} from '../utils/auditEventDisplay';

type Props = {
  events: AuditEventRecord[];
  emptyMessage?: string;
  /** Show session id in the timeline row. */
  showSession?: boolean;
  onSessionClick?: (sessionId: string, workType?: string | null) => void;
};

const AuditEventTimeline: React.FC<Props> = ({
  events,
  emptyMessage = 'No activity recorded for this session.',
  showSession = false,
  onSessionClick,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return <p className="audit-timeline-empty">{emptyMessage}</p>;
  }

  return (
    <ul className="audit-timeline" aria-label="Activity timeline">
      {events.map((event) => {
        const open = expandedId === event.id;
        const tone = auditOutcomeTone(event.outcome, event.error);
        const sessionId = event.target?.sessionId;
        return (
          <li key={event.id} className={`audit-timeline-item audit-timeline-item--${tone}`}>
            <button
              type="button"
              className="audit-timeline-summary"
              aria-expanded={open}
              onClick={() => setExpandedId(open ? null : event.id)}
            >
              <span className="audit-timeline-chevron" aria-hidden>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
              <span className="audit-timeline-time">{formatAuditTs(event.ts)}</span>
              <span className="audit-timeline-action">{auditActionLabel(event.action)}</span>
              <span className="audit-timeline-actor">
                <User size={13} aria-hidden />
                {auditActorLabel(event)}
              </span>
              {showSession && sessionId ? (
                onSessionClick ? (
                  <span
                    role="link"
                    tabIndex={0}
                    className="audit-timeline-session-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionClick(sessionId, event.target?.workType);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onSessionClick(sessionId, event.target?.workType);
                      }
                    }}
                  >
                    {sessionId.slice(0, 14)}…
                  </span>
                ) : (
                  <span className="audit-timeline-session">{sessionId.slice(0, 14)}…</span>
                )
              ) : null}
              <span className={`audit-timeline-outcome audit-timeline-outcome--${tone}`}>
                {event.error ? 'Failed' : event.outcome === 'success' ? 'OK' : event.outcome}
              </span>
            </button>
            {open ? (
              <div className="audit-timeline-details">
                <dl className="audit-timeline-dl">
                  {auditDetailEntries(event).map(({ key, value }) => (
                    <div key={key} className="audit-timeline-dl-row">
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

export default AuditEventTimeline;
