import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReadings, type DataSource } from '../context/ReadingsContext';
import { fetchUsageSummary, type UsageSummaryResponse } from '../services/api';
import type { WorkType } from '../types';
import { workTypeLabels } from '../types';
import {
  ArrowLeft,
  Users,
  RefreshCw,
  Loader2,
  Camera,
  Image as ImageIcon,
  Layers,
  Radio,
  Monitor,
  BarChart3,
} from 'lucide-react';

const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];
const dayRangeOptions = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
] as const;

const UsageSummary: React.FC = () => {
  const navigate = useNavigate();
  const { workType, setWorkType, dataSource, setDataSource } = useReadings();
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sourceOptions: { value: DataSource; label: string }[] = [
    { value: 'all', label: 'All sources' },
    { value: 'field', label: 'Field' },
    { value: 'simulator', label: 'Simulator' },
  ];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchUsageSummary(dataSource, workType, days);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dataSource, workType, days]);

  const maxDayImages = useMemo(() => {
    const rows = data?.byDay ?? [];
    return Math.max(1, ...rows.map((d) => d.images));
  }, [data]);

  return (
    <div className="detail-page model-analytics-page usage-summary-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <div className="page-title">
            <Users size={32} strokeWidth={1.5} />
            <div>
              <h1>App usage</h1>
              <p>Sessions and images (rolling window)</p>
            </div>
          </div>
        </div>
      </header>

      <main className="detail-content model-analytics-main">
        <div className="model-analytics-toolbar">
          <div className="model-toolbar-group">
            <span className="model-toolbar-label">
              <Layers size={14} /> Work type
            </span>
            <select
              className="work-type-select model-toolbar-select"
              value={workType}
              onChange={(e) => setWorkType(e.target.value as WorkType)}
            >
              {workTypeOptions.map((wt) => (
                <option key={wt} value={wt}>
                  {wt} — {workTypeLabels[wt]}
                </option>
              ))}
            </select>
          </div>
          <div className="model-toolbar-group">
            <span className="model-toolbar-label">Source</span>
            <div className="source-toggle model-source-toggle">
              {sourceOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`source-btn ${dataSource === opt.value ? 'active' : ''}`}
                  onClick={() => setDataSource(opt.value)}
                >
                  {opt.value === 'field' ? <Radio size={14} /> : opt.value === 'simulator' ? <Monitor size={14} /> : <Layers size={14} />}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="model-toolbar-group">
            <span className="model-toolbar-label">Window</span>
            <select
              className="work-type-select model-toolbar-select usage-days-select"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {dayRangeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="refresh-button model-refresh" onClick={load} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>

        <section className="metadata-section model-intro">
          <h2>
            <BarChart3 size={20} /> What you&apos;re seeing
          </h2>
          <p className="data-arch-lead">
            Counts are computed from the <strong>same S3 session list</strong> as the dashboard (parsed{' '}
            <code>metadata.json</code> per folder). Each <strong>session</strong> is one upload; <strong>images</strong>{' '}
            is the number of image files in that folder. <strong>Users</strong> come from{' '}
            <code>user_name</code> / <code>user_email</code> in metadata when the app fills them in — otherwise they
            appear as &quot;Unknown&quot;. In the <strong>readings list</strong> and <strong>dashboard</strong>, each
            session is grouped by <strong>Pacific</strong> calendar day (<code>America/Los_Angeles</code>) from its
            timestamp. The tables below use the server&apos;s UTC day buckets for daily totals.
          </p>
        </section>

        {loading && (
          <div className="loading-state">
            <Loader2 size={40} className="spin" />
            <p>Loading usage…</p>
          </div>
        )}

        {error && !loading && (
          <div className="error-banner">
            <span>{error}</span>
            <span className="hint">Ensure the API server is running (npm run server).</span>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="usage-stat-cards">
              <div className="usage-stat-card">
                <div className="usage-stat-icon" style={{ color: '#64748b' }}>
                  <Camera size={22} />
                </div>
                <div className="usage-stat-value">{data.totals.sessions.toLocaleString()}</div>
                <div className="usage-stat-label">Sessions in window</div>
              </div>
              <div className="usage-stat-card">
                <div className="usage-stat-icon" style={{ color: 'var(--accent-amber)' }}>
                  <ImageIcon size={22} />
                </div>
                <div className="usage-stat-value">{data.totals.images.toLocaleString()}</div>
                <div className="usage-stat-label">Images in window</div>
              </div>
              <div className="usage-stat-card">
                <div className="usage-stat-icon" style={{ color: '#06b6d4' }}>
                  <Users size={22} />
                </div>
                <div className="usage-stat-value">{data.totals.distinctUsers.toLocaleString()}</div>
                <div className="usage-stat-label">Distinct users</div>
              </div>
            </div>

            <p className="usage-window-meta">
              UTC window {data.windowStartUtc} → {data.windowEndUtc} · {data.daysEffective} day
              {data.daysEffective !== 1 ? 's' : ''} · {data.sessionCountInWindow.toLocaleString()} of{' '}
              {data.sessionCountAllScanned.toLocaleString()} loaded sessions in range
              {data.computedAt && (
                <>
                  {' '}
                  · updated {new Date(data.computedAt).toLocaleString()}
                </>
              )}
            </p>

            <section className="model-table-section">
              <h3 className="usage-section-title">By day (UTC)</h3>
              <div className="usage-mini-chart" aria-hidden={false}>
                {data.byDay.map((d) => (
                  <div key={d.date} className="usage-mini-chart-col" title={`${d.date}: ${d.sessions} sessions, ${d.images} images`}>
                    <div className="usage-mini-chart-track">
                      {d.images > 0 && (
                        <div
                          className="usage-mini-chart-fill"
                          style={{ height: `${(d.images / maxDayImages) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="usage-mini-chart-label">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
              <div className="table-container model-table-wrap">
                <table className="readings-table">
                  <thead>
                    <tr>
                      <th>Date (UTC)</th>
                      <th>Sessions</th>
                      <th>Images</th>
                      <th>Distinct users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDay.map((d) => (
                      <tr key={d.date}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{d.date}</td>
                        <td>{d.sessions.toLocaleString()}</td>
                        <td>{d.images.toLocaleString()}</td>
                        <td>{d.distinctUsers.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="model-table-section">
              <h3 className="usage-section-title">By user (top 50 in window)</h3>
              {data.byUser.length === 0 ? (
                <div className="chart-empty">No user metadata in this slice — check iOS fills user_name / user_email.</div>
              ) : (
                <div className="table-container model-table-wrap">
                  <table className="readings-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Sessions</th>
                        <th>Images</th>
                        <th>Last session</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byUser.map((u) => (
                        <tr key={u.userKey}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{u.userKey}</td>
                          <td>{u.sessions.toLocaleString()}</td>
                          <td>{u.images.toLocaleString()}</td>
                          <td>{u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default UsageSummary;
