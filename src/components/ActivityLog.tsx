import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Gauge,
  Clock,
  User,
  ArrowRightLeft,
  CheckCircle,
  AlertCircle,
  Search,
  Tag,
  Database,
  Loader2,
  Filter,
} from 'lucide-react';

interface ActivityEntry {
  id: string;
  timestamp: string;
  userEmail: string;
  action: string;
  sessionId: string;
  fromStatus: string;
  toStatus: string;
  sourceType: string;
}

const statusIcons: Record<string, React.ReactNode> = {
  correct: <CheckCircle size={14} />,
  incorrect_new: <AlertCircle size={14} />,
  incorrect_analyzed: <Search size={14} />,
  incorrect_labeled: <Tag size={14} />,
  incorrect_training: <Database size={14} />,
};

const statusColors: Record<string, string> = {
  correct: '#10b981',
  incorrect_new: '#ef4444',
  incorrect_analyzed: '#f59e0b',
  incorrect_labeled: '#8b5cf6',
  incorrect_training: '#06b6d4',
};

const formatStatusName = (status: string) => {
  return status
    .replace('incorrect_', 'Incorrect - ')
    .replace('correct', 'Correct')
    .replace('new', 'New')
    .replace('analyzed', 'Analyzed')
    .replace('labeled', 'Labeled')
    .replace('training', 'Training');
};

const ActivityLog: React.FC = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterAction, setFilterAction] = useState<string>('all');

  useEffect(() => {
    const loadActivities = async () => {
      try {
        const response = await fetch('/api/activity-log');
        if (response.ok) {
          const data = await response.json();
          setActivities(data);
        } else {
          setActivities([]);
        }
      } catch {
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };

    loadActivities();
  }, []);

  const filteredActivities = filterAction === 'all'
    ? activities
    : activities.filter(a => a.action === filterAction);

  return (
    <div className="activity-page">
      <header className="page-header">
        <div className="header-content">
          <button className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="page-title">
            <Gauge size={28} strokeWidth={1.5} />
            <div>
              <h1>Activity Log</h1>
              <p>Track all reading status changes</p>
            </div>
          </div>
        </div>
      </header>

      <div className="activity-content">
        <div className="activity-toolbar">
          <div className="activity-filter">
            <Filter size={16} />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="all">All Actions</option>
              <option value="status_change">Status Changes</option>
              <option value="bulk_move">Bulk Moves</option>
            </select>
          </div>
          <div className="activity-count">
            {filteredActivities.length} {filteredActivities.length === 1 ? 'entry' : 'entries'}
          </div>
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading activity log...</p>
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="empty-activity">
            <Clock size={48} />
            <h3>No Activity Yet</h3>
            <p>Status changes and bulk operations will be recorded here.</p>
          </div>
        ) : (
          <div className="activity-timeline">
            {filteredActivities.map((activity) => (
              <div key={activity.id} className="activity-item">
                <div className="activity-dot">
                  <ArrowRightLeft size={14} />
                </div>
                <div className="activity-card">
                  <div className="activity-header">
                    <div className="activity-user">
                      <User size={14} />
                      <span>{activity.userEmail}</span>
                    </div>
                    <div className="activity-time">
                      <Clock size={14} />
                      <span>{new Date(activity.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="activity-body">
                    <span className="activity-session">{activity.sessionId}</span>
                    <div className="activity-transition">
                      <span
                        className="activity-status from"
                        style={{ color: statusColors[activity.fromStatus] || '#9ca3af' }}
                      >
                        {statusIcons[activity.fromStatus]}
                        {formatStatusName(activity.fromStatus)}
                      </span>
                      <ArrowRightLeft size={14} className="transition-arrow" />
                      <span
                        className="activity-status to"
                        style={{ color: statusColors[activity.toStatus] || '#9ca3af' }}
                      >
                        {statusIcons[activity.toStatus]}
                        {formatStatusName(activity.toStatus)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityLog;
