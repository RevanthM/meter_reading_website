import { useEffect, useState } from 'react';
import { BookOpen, Gauge, X } from 'lucide-react';
import { statusLabels, type ReadingStatus } from '../types';

const WELCOME_SESSION_KEY = 'meter_portal_welcome_dismissed_session';
const WELCOME_NEVER_KEY = 'meter_portal_welcome_never_v1';

const GLOSSARY: { status: ReadingStatus; hint: string }[] = [
  { status: 'correct', hint: 'The capture is treated as a good reading for this session (agreement / accepted outcome).' },
  { status: 'incorrect_new', hint: 'Flagged incorrect from the field app; new in the review queue — next step is triage or analysis.' },
  { status: 'incorrect_analyzed', hint: 'Someone has reviewed diagnostics (e.g. model vs user); use this to track deeper review.' },
  { status: 'incorrect_labeled', hint: 'Ground truth or labels are applied so the session can be used as training input.' },
  { status: 'incorrect_training', hint: 'Marked as included in or ready for the training dataset / export pipeline.' },
  { status: 'no_dials', hint: 'No dials were detected or the meter type has no visible dials in the images.' },
  { status: 'not_sure', hint: 'Image or reading is ambiguous; needs a human decision before counting it as correct or incorrect.' },
];

const PortalWelcomeModal: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('portal-welcome-open', onOpen);
    return () => window.removeEventListener('portal-welcome-open', onOpen);
  }, []);

  const dismissSession = () => {
    try {
      sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const dismissNever = () => {
    try {
      localStorage.setItem(WELCOME_NEVER_KEY, '1');
      sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="login-modal-overlay portal-welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-welcome-title"
    >
      <div className="login-modal login-panel portal-welcome-panel">
        <div className="login-header login-modal-header portal-welcome-header">
          <div className="login-logo">
            <Gauge size={28} strokeWidth={1.5} />
          </div>
          <div>
            <h1 id="portal-welcome-title">Welcome</h1>
            <p className="login-header-subtitle portal-welcome-subtitle">
              Meter reading operations portal — quick orientation and status meanings.
            </p>
          </div>
          <button
            type="button"
            className="portal-welcome-close"
            onClick={dismissSession}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <div className="portal-welcome-body">
          <section className="portal-welcome-section">
            <h2><BookOpen size={18} /> What this portal does</h2>
            <ul className="portal-welcome-list">
              <li>Lists meter sessions from cloud storage by <strong>work type</strong> and <strong>source</strong> (field vs simulator).</li>
              <li>Lets you open a session, inspect images and metadata, and <strong>change status</strong> — which moves the session folder in storage to match your workflow.</li>
              <li>Offers <strong>ZIP export</strong>: all incorrect-queue sessions from the dashboard or list, or <strong>this session only</strong> on the reading detail page (images + <code>metadata.json</code>) for labeling and model retraining.</li>
              <li>The <strong>Models</strong> page summarizes app/model versions and session mix for comparing generations over time.</li>
              <li><strong>Usage</strong> shows sessions, image counts, and distinct users per day from the same S3 metadata (until Dynamo backs it).</li>
            </ul>
          </section>

          <section className="portal-welcome-section">
            <h2>Status glossary</h2>
            <p className="portal-welcome-glossary-intro">
              Status reflects where the session sits in review and training — not the same as offline model accuracy (mAP).
            </p>
            <div className="portal-welcome-table-wrap">
              <table className="portal-welcome-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {GLOSSARY.map((row) => (
                    <tr key={row.status}>
                      <td>{statusLabels[row.status]}</td>
                      <td>{row.hint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="login-footer login-footer--row login-modal-footer portal-welcome-footer">
          <button type="button" className="login-link-btn" onClick={dismissNever}>
            Don&apos;t show again
          </button>
          <button type="button" className="login-submit" onClick={dismissSession}>
            Continue to portal
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortalWelcomeModal;
