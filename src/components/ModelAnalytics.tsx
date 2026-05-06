import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReadings, type DataSource } from '../context/ReadingsContext';
import { fetchModelAnalytics, type ModelAnalyticsResponse, type ModelVersionStats } from '../services/api';
import type { WorkType } from '../types';
import { workTypeLabels } from '../types';
import {
  ArrowLeft,
  Cpu,
  RefreshCw,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
  Layers,
  Radio,
  Monitor,
  List,
} from 'lucide-react';

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtMs(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(0)} ms`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function DeltaCell({
  current,
  previous,
  higherIsBetter,
  format,
  formatDelta,
}: {
  current: number | null;
  previous: number | null;
  higherIsBetter: boolean;
  format: (v: number | null) => string;
  /** How to render signed delta vs the older row (e.g. ms or percentage points). */
  formatDelta?: (delta: number) => string;
}) {
  if (current == null || previous == null) {
    return <span className="model-metric">{format(current)}</span>;
  }
  const delta = current - previous;
  if (Math.abs(delta) < 1e-9) {
    return (
      <span className="model-metric model-delta-neutral">
        {format(current)} <Minus size={12} className="inline-icon" />
      </span>
    );
  }
  const better = higherIsBetter ? delta > 0 : delta < 0;
  const Icon = better ? TrendingUp : TrendingDown;
  const cls = better ? 'model-delta-pos' : 'model-delta-neg';
  const deltaLabel = formatDelta ? formatDelta(delta) : format(Math.abs(delta));
  return (
    <span className={`model-metric ${cls}`}>
      {format(current)}
      <Icon size={14} className="inline-icon" />
      <span className="model-delta-value">({deltaLabel})</span>
    </span>
  );
}

const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

const ModelAnalytics: React.FC = () => {
  const navigate = useNavigate();
  const { workType, setWorkType, dataSource, setDataSource, filteredReadings } = useReadings();
  const [data, setData] = useState<ModelAnalyticsResponse | null>(null);
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
      const res = await fetchModelAnalytics(dataSource, workType);
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
  }, [dataSource, workType]);

  const versions = data?.versions ?? [];

  const openVersionReadings = useCallback(
    (appVersion: string) => {
      navigate(`/readings/all?appVersion=${encodeURIComponent(appVersion)}`);
    },
    [navigate],
  );

  /** Fallback when API omits imageCount (older server); matches analytics bucket keys. */
  const imageTotalsByVersion = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredReadings) {
      const v =
        r.appVersion != null && String(r.appVersion).trim() !== ''
          ? String(r.appVersion).trim()
          : 'unknown';
      m.set(v, (m.get(v) ?? 0) + (Array.isArray(r.images) ? r.images.length : 0));
    }
    return m;
  }, [filteredReadings]);

  const formatImageCountCell = (row: ModelVersionStats) => {
    if (row.imageCount != null) return row.imageCount.toLocaleString();
    const n = imageTotalsByVersion.get(row.appVersion);
    return n != null ? n.toLocaleString() : '—';
  };

  const narrative = useMemo(() => {
    if (versions.length === 0) return null;
    const cur = versions[0];
    const prev = versions[1];
    if (!prev) {
      return `Only one app version in this slice (${cur.appVersion}). Ship a new iOS build with a higher AppConfig.appVersion to compare generations.`;
    }
    const dCorrect = (cur.queueCorrectRate - prev.queueCorrectRate) * 100;
    const dConf =
      cur.avgConfidence != null && prev.avgConfidence != null
        ? (cur.avgConfidence - prev.avgConfidence) * 100
        : null;
    const parts = [
      `Most recent uploads: ${cur.appVersion} (previous row: ${prev.appVersion}).`,
      `Correct-queue share ${pct(cur.queueCorrectRate)} vs ${pct(prev.queueCorrectRate)} (${dCorrect >= 0 ? '+' : ''}${dCorrect.toFixed(1)} pts).`,
    ];
    if (dConf != null) {
      parts.push(`Mean confidence ${dConf >= 0 ? '+' : ''}${dConf.toFixed(1)} pts vs previous version.`);
    }
    return parts.join(' ');
  }, [versions]);

  return (
    <div className="detail-page model-analytics-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <div className="page-title">
            <Cpu size={32} strokeWidth={1.5} />
            <div>
              <h1>Model generations</h1>
              <p>Compare app versions from session metadata</p>
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
          <button type="button" className="refresh-button model-refresh" onClick={load} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>

        <section className="metadata-section model-intro">
          <h2>
            <Sparkles size={20} /> How to read this
          </h2>
          <p className="data-arch-lead">
            Each iOS upload includes <code>app_version</code> in <code>metadata.json</code> (today tied to{' '}
            <code>AppConfig.appVersion</code> on device). Sessions are grouped by that tag so you can compare **current
            vs past** generations: queue mix (correct vs incorrect pipelines), mean confidence, mean latency, dial
            counts, and <strong>total images</strong> stored under those sessions. Use <strong>Open list</strong> to
            see which captures used which version (then <strong>View images</strong> per row). The row with the
            latest session is marked <strong>Current</strong>.
          </p>
          {narrative && <p className="model-narrative">{narrative}</p>}
        </section>

        {loading && (
          <div className="loading-state">
            <Loader2 size={40} className="spin" />
            <p>Computing analytics from S3…</p>
          </div>
        )}

        {error && !loading && (
          <div className="error-banner">
            <span>{error}</span>
            <span className="hint">Ensure the API server is running (npm run server).</span>
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="chart-empty">No sessions for this work type and source.</div>
        )}

        {!loading && !error && versions.length > 0 && (
          <section className="model-table-section">
            <div className="model-table-meta">
              <span>
                <Cpu size={14} /> {versions.length} version{versions.length !== 1 ? 's' : ''}
                <span className="model-table-meta-hint"> · click a row to open the session list for that version</span>
              </span>
              {data?.computedAt && (
                <span className="model-computed-at">
                  Updated {new Date(data.computedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="table-container model-table-wrap">
              <table className="readings-table model-version-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Sessions</th>
                    <th>Images</th>
                    <th>Correct queue</th>
                    <th>Incorrect queues</th>
                    <th>Not sure</th>
                    <th>No dials</th>
                    <th>Avg confidence</th>
                    <th>Avg latency</th>
                    <th>Avg dials</th>
                    <th>Field / Sim</th>
                    <th>Last session</th>
                    <th>Open list</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((row: ModelVersionStats, i: number) => {
                    const prev = versions[i + 1];
                    const isCurrent = row.appVersion === data?.currentVersion;
                    return (
                      <tr
                        key={row.appVersion}
                        className={['model-version-row-clickable', isCurrent ? 'model-row-current' : '']
                          .filter(Boolean)
                          .join(' ')}
                        tabIndex={0}
                        role="link"
                        aria-label={`View sessions and images for app version ${row.appVersion}`}
                        onClick={() => openVersionReadings(row.appVersion)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openVersionReadings(row.appVersion);
                          }
                        }}
                      >
                        <td>
                          <span className="model-version-cell">
                            <code>{row.appVersion}</code>
                            {isCurrent && (
                              <span className="model-badge-current">
                                <Sparkles size={12} /> Current
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          {prev ? (
                            <DeltaCell
                              current={row.sessions}
                              previous={prev.sessions}
                              higherIsBetter={true}
                              format={(v) => String(v ?? '—')}
                              formatDelta={(d) => `${d >= 0 ? '+' : ''}${d}`}
                            />
                          ) : (
                            row.sessions
                          )}
                        </td>
                        <td>{formatImageCountCell(row)}</td>
                        <td>{pct(row.queueCorrectRate)}</td>
                        <td>{pct(row.queueIncorrectRate)}</td>
                        <td>{pct(row.notSureRate)}</td>
                        <td>{pct(row.noDialsRate)}</td>
                        <td>
                          {prev ? (
                            <DeltaCell
                              current={row.avgConfidence}
                              previous={prev.avgConfidence}
                              higherIsBetter={true}
                              format={(v) => pct(v)}
                              formatDelta={(d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts`}
                            />
                          ) : (
                            pct(row.avgConfidence)
                          )}
                        </td>
                        <td>
                          {prev ? (
                            <DeltaCell
                              current={row.avgProcessingTimeMs}
                              previous={prev.avgProcessingTimeMs}
                              higherIsBetter={false}
                              format={(v) => fmtMs(v)}
                              formatDelta={(d) => `${d >= 0 ? '+' : ''}${Math.round(d)} ms`}
                            />
                          ) : (
                            fmtMs(row.avgProcessingTimeMs)
                          )}
                        </td>
                        <td>{fmtNum(row.avgDialCount, 2)}</td>
                        <td>
                          {row.fieldCount} / {row.simulatorCount}
                        </td>
                        <td className="model-date-cell">
                          {row.lastSessionAt
                            ? new Date(row.lastSessionAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="model-table-link-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openVersionReadings(row.appVersion);
                            }}
                          >
                            <List size={14} aria-hidden />
                            Sessions
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default ModelAnalytics;
