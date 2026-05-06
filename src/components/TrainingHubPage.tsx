import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Navigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft,
  GraduationCap,
  Loader2,
  FolderPlus,
  Plus,
  Image as ImageIcon,
} from 'lucide-react';
import type { FC } from 'react';
import {
  createTrainingDataset,
  fetchTrainingDatasets,
  copySessionsToTrainingDataset,
  type TrainingDatasetRow,
  type TrainingDatasetsResponse,
  type S3MeterReading,
} from '../services/api';
import type { WorkType } from '../types';
import { useReadings } from '../context/ReadingsContext';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { folderPrefixToSegment, pipelineDetailPath } from '../utils/trainingPipeline';

const MAX_THUMBS = 200;
/** Chunk size for copy API calls so the UI can show real progress. */
const COPY_SESSION_CHUNK = 10;

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

const HUB_COHORT_IDS = ['untrained', 'correct', 'wrong', 'recommended'] as const;
type TrainingHubCohortId = (typeof HUB_COHORT_IDS)[number];
type TrainingHubCohort = 'all' | TrainingHubCohortId;

const HUB_COHORT_LABELS: Record<TrainingHubCohortId, string> = {
  untrained: 'Untrained',
  correct: 'Reviewed correct',
  wrong: 'Reviewed wrong',
  recommended: 'Reviewer recommended',
};

function matchesTrainingHubCohort(r: S3MeterReading, cohort: TrainingHubCohort): boolean {
  if (cohort === 'all') return true;
  switch (cohort) {
    case 'untrained':
      return r.status === 'incorrect_new';
    case 'correct':
      return r.status === 'correct';
    case 'wrong':
      return (
        r.status === 'incorrect_analyzed' ||
        r.status === 'incorrect_labeled' ||
        r.status === 'incorrect_training'
      );
    case 'recommended':
      return r.reviewerRecommendTraining === true;
  }
}

function sessionDateKey(r: S3MeterReading): string {
  const raw = r.dateOfReading || r.createdAt || '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

function sessionTimestamp(r: S3MeterReading): number {
  const t = new Date(r.dateOfReading || r.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function startOfTodayLocalMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfTodayLocalMs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Sort key: larger = more recent (API fields or `name_<ms>` folder segment). */
function pipelineRecencyMs(r: TrainingDatasetRow): number {
  if (typeof r.timestamp === 'number' && Number.isFinite(r.timestamp)) return r.timestamp;
  for (const iso of [r.createdAt, r.lastCopyAt]) {
    if (iso) {
      const t = new Date(iso).getTime();
      if (Number.isFinite(t)) return t;
    }
  }
  const seg = folderPrefixToSegment(r.folderPrefix);
  const m = /_(\d{10,})$/.exec(seg);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function matchesDatePreset(r: S3MeterReading, preset: DatePreset, specificDay: string): boolean {
  const ts = sessionTimestamp(r);
  if (preset === 'all') return true;
  if (preset === 'today') {
    return ts >= startOfTodayLocalMs() && ts <= endOfTodayLocalMs();
  }
  if (preset === '7d') return ts >= Date.now() - 7 * 86400000;
  if (preset === '30d') return ts >= Date.now() - 30 * 86400000;
  if (preset === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(specificDay)) return true;
    return sessionDateKey(r) === specificDay;
  }
  return true;
}

function pickPreviewUrl(r: S3MeterReading): string | null {
  const imgs = r.images || [];
  const orig = imgs.find((i) => (i.fileName || '').toLowerCase() === 'original.jpg');
  const pick = orig || imgs[0];
  return pick?.url || null;
}

const SessionThumb: FC<{
  url: string | null;
  sessionId: string;
  status: string;
  dateLine: string;
  selected: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onToggleSelect: () => void;
}> = ({ url, sessionId, status, dateLine, selected, draggable, onDragStart, onToggleSelect }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(url) && !imgFailed;
  const hint = draggable
    ? `${sessionId} · ${status} — toggle checkbox or card; drag to a pipeline or use Copy selected`
    : `${sessionId} · ${status}`;
  return (
    <div
      className={`training-hub-thumb-card${selected ? ' training-hub-thumb-card--selected' : ''}`}
      role="listitem"
    >
      <input
        type="checkbox"
        className="training-hub-thumb-checkbox"
        checked={selected}
        onChange={() => onToggleSelect()}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select session ${sessionId}`}
      />
      <button
        type="button"
        className="training-hub-thumb"
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={() => onToggleSelect()}
        title={hint}
      >
        <div className="training-hub-thumb-image-wrap">
          {showImg ? (
            <img
              src={url!}
              alt=""
              className="training-hub-thumb-img"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="training-hub-thumb-placeholder">{url ? 'Preview unavailable' : 'No image'}</span>
          )}
        </div>
        <span className="training-hub-thumb-id">{sessionId}</span>
        <span className="training-hub-thumb-meta">{dateLine || '—'}</span>
      </button>
    </div>
  );
};

const TrainingHubPage: FC = () => {
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  if (outletCtx?.workMode === 'reviewer') {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const {
    readings,
    filteredReadings,
    loading: readingsLoading,
    isUsingRealData,
    dataSource,
    setDataSource,
    workType,
    refreshData,
    getReadingById,
  } = useReadings();

  const [meta, setMeta] = useState<Pick<TrainingDatasetsResponse, 'bucket' | 'rootPrefix' | 'trainingDatasetsSegment'> | null>(
    null,
  );
  const [rows, setRows] = useState<TrainingDatasetRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [hubCohort, setHubCohort] = useState<TrainingHubCohort>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [specificDay, setSpecificDay] = useState('');
  const [uploaderQuery, setUploaderQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dropTargetPrefix, setDropTargetPrefix] = useState<string | null>(null);
  const [copyBusyPrefix, setCopyBusyPrefix] = useState<string | null>(null);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const [copyProgress, setCopyProgress] = useState<{ total: number; done: number } | null>(null);
  const [bulkPipelinePrefix, setBulkPipelinePrefix] = useState('');
  const selectAllVisibleInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const data = await fetchTrainingDatasets();
      setMeta({
        bucket: data.bucket,
        rootPrefix: data.rootPrefix,
        trainingDatasetsSegment: data.trainingDatasetsSegment,
      });
      setRows(data.datasets);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load pipelines.');
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const uploaderLower = uploaderQuery.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    let list = filteredReadings.filter((r) => matchesTrainingHubCohort(r, hubCohort));
    list = list.filter((r) => matchesDatePreset(r, datePreset, specificDay));
    if (uploaderLower) {
      list = list.filter((r) => (r.userName || '').toLowerCase().includes(uploaderLower));
    }
    list.sort((a, b) => new Date(b.dateOfReading || 0).getTime() - new Date(a.dateOfReading || 0).getTime());
    return list;
  }, [filteredReadings, hubCohort, datePreset, specificDay, uploaderLower]);

  const visibleSessions = useMemo(
    () => filteredSessions.slice(0, MAX_THUMBS),
    [filteredSessions],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allVisibleSelected =
    visibleSessions.length > 0 && visibleSessions.every((r) => selectedSet.has(r.id));
  const someVisibleSelected = visibleSessions.some((r) => selectedSet.has(r.id));

  useEffect(() => {
    const el = selectAllVisibleInputRef.current;
    if (!el) return;
    el.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  const onSelectAllVisibleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds((prev) => {
        const s = new Set(prev);
        visibleSessions.forEach((r) => s.add(r.id));
        return [...s];
      });
    } else {
      const vis = new Set(visibleSessions.map((r) => r.id));
      setSelectedIds((prev) => prev.filter((id) => !vis.has(id)));
    }
  };

  const selectAllMatching = () => {
    setSelectedIds(filteredSessions.map((r) => r.id));
  };

  const buildCopyPayload = (sessionIds: string[]) => {
    const out: { sessionId: string; s3SessionPrefix?: string; workType?: WorkType }[] = [];
    for (const id of sessionIds) {
      const r = getReadingById(id) || readings.find((x) => x.id === id);
      if (!r?.s3SessionPrefix) continue;
      out.push({
        sessionId: r.id,
        s3SessionPrefix: r.s3SessionPrefix,
        workType,
      });
    }
    return out;
  };

  const copyToPipeline = async (folderPrefix: string, sessionIds: string[]) => {
    const sessions = buildCopyPayload(sessionIds);
    if (sessions.length === 0) {
      setDropMessage('No sessions with storage paths to copy (reload if using mock data).');
      return;
    }
    setDropTargetPrefix(null);
    setCopyBusyPrefix(folderPrefix);
    setDropMessage(null);
    const total = sessions.length;
    setCopyProgress({ total, done: 0 });
    let copiedOk = 0;
    let errCount = 0;
    try {
      for (let i = 0; i < sessions.length; i += COPY_SESSION_CHUNK) {
        const chunk = sessions.slice(i, i + COPY_SESSION_CHUNK);
        setCopyProgress({ total, done: i });
        const res = await copySessionsToTrainingDataset(folderPrefix, chunk);
        copiedOk += res.copied?.length ?? 0;
        errCount += res.errors?.length ?? 0;
        setCopyProgress({ total, done: Math.min(i + chunk.length, total) });
      }
      setDropMessage(`Copied ${copiedOk} session(s)${errCount ? `, ${errCount} error(s)` : ''}.`);
      await load();
      await refreshData();
      setSelectedIds((prev) => prev.filter((id) => !sessionIds.includes(id)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Copy failed.';
      setDropMessage(
        copiedOk > 0 ? `${msg} (${copiedOk} session(s) copied before the failure.)` : msg,
      );
    } finally {
      setCopyBusyPrefix(null);
      setCopyProgress(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    const ids = selectedSet.has(sessionId) ? [...selectedSet] : [sessionId];
    e.dataTransfer.setData('application/x-meter-session-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const parseDroppedSessionIds = (e: React.DragEvent): string[] => {
    const raw = e.dataTransfer.getData('application/x-meter-session-ids');
    if (!raw) return [];
    try {
      const ids = JSON.parse(raw) as unknown;
      return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Name your pipeline first.');
      return;
    }
    const lower = trimmed.toLowerCase();
    const dup = rows.some((r) => !r.manifestMissing && r.displayName.trim().toLowerCase() === lower);
    if (dup) {
      setCreateError(`A pipeline named "${trimmed}" already exists. Use a different name.`);
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createTrainingDataset(trimmed);
      setName('');
      await load();
      const seg = folderPrefixToSegment(res.folderPrefix);
      navigate(pipelineDetailPath(seg));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setCreating(false);
    }
  };

  const pipelines = useMemo(() => {
    const list = rows.filter((r) => !r.manifestMissing);
    return [...list].sort((a, b) => pipelineRecencyMs(b) - pipelineRecencyMs(a));
  }, [rows]);

  useEffect(() => {
    if (!bulkPipelinePrefix) return;
    if (!pipelines.some((p) => p.folderPrefix === bulkPipelinePrefix)) {
      setBulkPipelinePrefix('');
    }
  }, [bulkPipelinePrefix, pipelines]);

  const handleBulkCopy = () => {
    if (!bulkPipelinePrefix || selectedIds.length === 0) return;
    void copyToPipeline(bulkPipelinePrefix, selectedIds);
  };

  return (
    <div className="detail-page training-hub-page">
      <header className="page-header training-hub-page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Home</span>
          </button>
          <div className="page-title">
            <GraduationCap size={32} strokeWidth={1.5} />
            <div>
              <h1>Training hub</h1>
              <p>
                Filters and pipeline tiles run across the top; previews fill the width below. Use <strong>Copy selected</strong>{' '}
                or drag thumbnails onto a pipeline tile. Pipelines under{' '}
                <code>{meta?.trainingDatasetsSegment ?? 'training-datasets'}/</code> in <code>{meta?.bucket ?? '…'}</code>.
                Work type: <strong>{workType}</strong> (toolbar).
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="training-hub-layout">
        <section className="training-hub-sessions-bar" aria-label="Session filters">
          <div className="training-hub-sessions-bar-inner">
            <div className="training-hub-filter-stack">
              <div className="training-hub-filter-band">
                <h2 className="training-hub-filter-band-heading">
                  <ImageIcon size={16} aria-hidden />
                  Sessions
                </h2>
                <span className="training-hub-filter-band-label" title="Same groups as the readings list">
                  Show
                </span>
                <div className="training-hub-chip-row training-hub-chip-row--tight" role="group" aria-label="Session cohort">
                  <button
                    type="button"
                    className={`training-hub-chip${hubCohort === 'all' ? ' training-hub-chip--active' : ''}`}
                    onClick={() => setHubCohort('all')}
                  >
                    All
                  </button>
                  {HUB_COHORT_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`training-hub-chip${hubCohort === id ? ' training-hub-chip--active' : ''}`}
                      onClick={() => setHubCohort(hubCohort === id ? 'all' : id)}
                    >
                      {HUB_COHORT_LABELS[id]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="training-hub-filter-band training-hub-filter-band--secondary">
                <span className="training-hub-filter-band-label">When</span>
                <div className="training-hub-chip-row training-hub-chip-row--tight" role="group" aria-label="Upload time range">
                  {(
                    [
                      ['all', 'All time'],
                      ['today', 'Today'],
                      ['7d', '7 days'],
                      ['30d', '30 days'],
                      ['custom', 'Pick day'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`training-hub-chip${datePreset === key ? ' training-hub-chip--active' : ''}`}
                      onClick={() => setDatePreset(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {datePreset === 'custom' ? (
                  <input
                    id="training-hub-specific-day"
                    type="date"
                    className="training-hub-filter-input training-hub-filter-input--date-inline"
                    value={specificDay}
                    onChange={(e) => setSpecificDay(e.target.value)}
                    aria-label="Calendar day"
                  />
                ) : null}
                <span className="training-hub-filter-band-divider" aria-hidden />
                <span className="training-hub-filter-band-label">Source</span>
                <div className="training-hub-chip-row training-hub-chip-row--tight" role="group" aria-label="Data source">
                  {(['all', 'field', 'simulator'] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      className={`training-hub-chip${dataSource === src ? ' training-hub-chip--active' : ''}`}
                      onClick={() => setDataSource(src)}
                    >
                      {src === 'all' ? 'All' : src === 'field' ? 'Field' : 'Simulator'}
                    </button>
                  ))}
                </div>
                <span className="training-hub-filter-band-divider" aria-hidden />
                <label className="training-hub-filter-band-label" htmlFor="training-hub-uploader">
                  Uploader
                </label>
                <input
                  id="training-hub-uploader"
                  type="search"
                  className="training-hub-filter-input training-hub-filter-input--inline-search"
                  placeholder="Name or email…"
                  value={uploaderQuery}
                  onChange={(e) => setUploaderQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="training-hub-pipelines-strip" aria-label="Training pipelines">
          <div className="training-hub-pipelines-strip-inner">
            <div className="training-hub-pipelines-strip-head">
              <div className="training-hub-pipelines-strip-intro">
                <h2 className="training-hub-list-title">Pipelines</h2>
                <p className="training-hub-list-sub">
                  Scroll sideways — click a tile to open. Drop thumbnails on a tile or use Copy selected under Previews.
                </p>
              </div>
              <div className="training-hub-toolbar training-hub-toolbar--pipelines training-hub-toolbar--pipelines-bar">
                <div className="training-hub-create">
                  <label className="sr-only" htmlFor="new-pipeline-name">
                    New pipeline name
                  </label>
                  <input
                    id="new-pipeline-name"
                    type="text"
                    className="training-hub-name-input"
                    placeholder="new pipeline name"
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={creating}
                  />
                  <button
                    type="button"
                    className="training-hub-create-btn"
                    onClick={() => void handleCreate()}
                    disabled={creating || !name.trim()}
                  >
                    {creating ? (
                      <>
                        <Loader2 size={18} className="spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <Plus size={18} />
                        new pipeline
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
            {createError ? <p className="training-hub-inline-error training-hub-strip-error">{createError}</p> : null}
            {dropMessage ? <p className="training-hub-drop-toast training-hub-strip-toast">{dropMessage}</p> : null}
            {loading ? (
              <p className="training-hub-loading">
                <Loader2 size={20} className="spin" aria-hidden /> Loading…
              </p>
            ) : null}
            {loadError ? <p className="training-hub-inline-error training-hub-strip-error">{loadError}</p> : null}
            {!loading && !loadError && pipelines.length === 0 ? (
              <p className="training-hub-empty">No pipelines yet. Create one above.</p>
            ) : null}
            {!loading && pipelines.length > 0 ? (
              <ul className="training-hub-pipeline-list training-hub-pipeline-list--strip">
                {pipelines.map((r) => {
                  const seg = folderPrefixToSegment(r.folderPrefix);
                  const busy = copyBusyPrefix === r.folderPrefix;
                  const over = dropTargetPrefix === r.folderPrefix;
                  const metaParts: string[] = [];
                  if (typeof r.copiedSessionCount === 'number') metaParts.push(`${r.copiedSessionCount} sessions`);
                  if (r.weights?.s3Key) metaParts.push('weights.pt');
                  metaParts.push(seg);
                  const metaLine = metaParts.join(' · ');
                  return (
                    <li key={r.folderPrefix}>
                      <button
                        type="button"
                        className={`training-hub-pipeline-row training-hub-pipeline-row--compact training-hub-pipeline-row--strip-tile training-hub-pipeline-hit${
                          over ? ' training-hub-pipeline-hit--over' : ''
                        }`}
                        title={`Open ${r.displayName} — ${metaLine}`}
                        onClick={() => navigate(pipelineDetailPath(seg))}
                        disabled={busy}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
                          setDropTargetPrefix(r.folderPrefix);
                        }}
                        onDragLeave={(e) => {
                          const rel = e.relatedTarget;
                          if (rel instanceof Node && !e.currentTarget.contains(rel)) {
                            setDropTargetPrefix(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTargetPrefix(null);
                          const ids = parseDroppedSessionIds(e);
                          if (ids.length) void copyToPipeline(r.folderPrefix, ids);
                        }}
                      >
                        <span className="training-hub-pipeline-icon" aria-hidden>
                          {busy ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} strokeWidth={2} />}
                        </span>
                        <span className="training-hub-pipeline-inline">
                          <span className="training-hub-pipeline-name">{r.displayName}</span>
                          <span className="training-hub-pipeline-meta-inline">{metaLine}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </section>

        {copyProgress ? (
          <div className="training-hub-copy-progress" role="status" aria-live="polite">
            <div className="training-hub-copy-progress-track" aria-hidden>
              <div
                className="training-hub-copy-progress-fill"
                style={{
                  width: `${copyProgress.total ? Math.min(100, Math.round((copyProgress.done / copyProgress.total) * 100)) : 0}%`,
                }}
              />
            </div>
            <span className="training-hub-copy-progress-label">
              Copying to training folder… {copyProgress.done}/{copyProgress.total} sessions
            </span>
          </div>
        ) : null}

        <div className="training-hub-work">
          <section className="training-hub-preview-column" aria-label="Session thumbnails">
            <div className="training-hub-preview-head">
              <h3 className="training-hub-preview-title">Previews</h3>
              <div className="training-hub-preview-toolbar">
                <span className="training-hub-count">
                  {filteredSessions.length} match
                  {filteredSessions.length > MAX_THUMBS ? ` · showing ${MAX_THUMBS}` : ''}
                </span>
                <div className="training-hub-preview-actions">
                  <label className="training-hub-select-all-check">
                    <input
                      ref={selectAllVisibleInputRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={onSelectAllVisibleChange}
                      disabled={visibleSessions.length === 0}
                      aria-label="Select all (visible in grid)"
                    />
                    <span>Select all</span>
                  </label>
                  {filteredSessions.length > visibleSessions.length ? (
                    <button
                      type="button"
                      className="training-hub-text-btn"
                      onClick={selectAllMatching}
                      disabled={filteredSessions.length === 0}
                    >
                      Select all matches ({filteredSessions.length})
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="training-hub-text-btn"
                    onClick={() => setSelectedIds([])}
                    disabled={selectedIds.length === 0}
                  >
                    Clear
                  </button>
                  <label htmlFor="training-hub-bulk-pipeline" className="training-hub-bulk-label">
                    Add to
                  </label>
                  <select
                    id="training-hub-bulk-pipeline"
                    className="training-hub-bulk-select"
                    value={bulkPipelinePrefix}
                    onChange={(e) => setBulkPipelinePrefix(e.target.value)}
                    disabled={pipelines.length === 0}
                  >
                    <option value="">Pipeline…</option>
                    {pipelines.map((p) => (
                      <option key={p.folderPrefix} value={p.folderPrefix}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="training-hub-bulk-copy-btn"
                    onClick={handleBulkCopy}
                    disabled={!bulkPipelinePrefix || selectedIds.length === 0 || Boolean(copyBusyPrefix)}
                  >
                    Copy selected
                  </button>
                </div>
              </div>
            </div>

            {selectedIds.length > 0 ? (
              <p className="training-hub-selection-hint" aria-live="polite">
                {selectedIds.length} selected — choose a pipeline and Copy selected (or drag onto a tile above)
              </p>
            ) : null}

            {!isUsingRealData ? (
              <p className="training-hub-inline-error training-hub-mock-banner">
                Mock data: copies are disabled until the API returns real sessions with S3 paths.
              </p>
            ) : null}

            <div className="training-hub-thumb-grid" role="list">
              {readingsLoading ? (
                <p className="training-hub-side-loading">
                  <Loader2 size={18} className="spin" aria-hidden /> Loading sessions…
                </p>
              ) : visibleSessions.length === 0 ? (
                <p className="training-hub-side-empty">No sessions match these filters.</p>
              ) : (
                visibleSessions.map((r) => {
                  const url = pickPreviewUrl(r);
                  const sel = selectedSet.has(r.id);
                  return (
                    <SessionThumb
                      key={r.id}
                      url={url}
                      sessionId={r.id}
                      status={r.status}
                      dateLine={sessionDateKey(r) || '—'}
                      selected={sel}
                      draggable={Boolean(r.s3SessionPrefix && isUsingRealData)}
                      onDragStart={(e) => handleDragStart(e, r.id)}
                      onToggleSelect={() => toggleSelect(r.id)}
                    />
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TrainingHubPage;
