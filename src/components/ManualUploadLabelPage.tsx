import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ImageIcon,
  Loader2,
  Maximize2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import ManualLabelLightbox from './ManualLabelLightbox';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import { patchSessionMetadata, type S3MeterReading } from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { normalizeFourDigitReading } from '../utils/manualUpload';
import {
  type DateRangePresetId,
  formatPresetLabel,
  getDateRangeFromPreset,
} from '../utils/dateRangePresets';
import { calendarDayKeyInPortalTz, formatReadingShortDate } from '../utils/readingDisplayDates';

const UPLOAD_ROLES = new Set(['reviewer', 'test_data_reviewer', 'admin']);

type StatusFilter = 'new' | 'reviewed' | 'all';

const DATE_PRESETS: DateRangePresetId[] = ['today', 'yesterday', 'last7', 'last30'];

function needsLabel(r: S3MeterReading): boolean {
  if (r.status !== 'manually_uploaded') return false;
  if (r.manualLabelPending === true) return true;
  return !normalizeFourDigitReading(r.expectedValue ?? '');
}

function isReviewed(r: S3MeterReading): boolean {
  return r.status === 'manually_uploaded' && !needsLabel(r);
}

function thumbUrl(r: S3MeterReading): string | undefined {
  const full = r.images.find((img) => /original\.(jpe?g|png|webp)$/i.test(img.fileName || ''));
  return (full ?? r.images[0])?.url;
}

function matchesDatePreset(r: S3MeterReading, preset: DateRangePresetId | ''): boolean {
  if (!preset) return true;
  const { from, to } = getDateRangeFromPreset(preset);
  const day = calendarDayKeyInPortalTz(r.dateOfReading || '');
  return Boolean(day && day >= from && day <= to);
}

const ManualUploadLabelPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { userEmail } = useAuth();
  const {
    workType,
    ensureReadingsLoaded,
    readingsLoading,
    getReadingsByStatus,
    upsertReading,
    refreshData,
  } = useReadings();

  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const canUse = UPLOAD_ROLES.has(portalWorkMode);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [datePreset, setDatePreset] = useState<DateRangePresetId | ''>('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleListRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshData]);

  useEffect(() => {
    if (!canUse) {
      navigate('/', { replace: true });
    }
  }, [canUse, navigate]);

  useEffect(() => {
    void ensureReadingsLoaded();
  }, [ensureReadingsLoaded]);

  const allManual = useMemo(
    () => getReadingsByStatus('manually_uploaded') as S3MeterReading[],
    [getReadingsByStatus],
  );

  const counts = useMemo(() => {
    const byDate = (r: S3MeterReading) => matchesDatePreset(r, datePreset);
    const pool = allManual.filter(byDate);
    return {
      new: pool.filter(needsLabel).length,
      reviewed: pool.filter(isReviewed).length,
      all: pool.length,
    };
  }, [allManual, datePreset]);

  const queue = useMemo(() => {
    let list = allManual.filter((r) => matchesDatePreset(r, datePreset));
    if (statusFilter === 'new') list = list.filter(needsLabel);
    else if (statusFilter === 'reviewed') list = list.filter(isReviewed);
    return [...list].sort(
      (a, b) => new Date(b.dateOfReading || 0).getTime() - new Date(a.dateOfReading || 0).getTime(),
    );
  }, [allManual, datePreset, statusFilter]);

  const lightboxReading = lightboxIndex != null ? queue[lightboxIndex] : null;
  const lightboxUrl = lightboxReading ? thumbUrl(lightboxReading) : undefined;

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const moveLightbox = useCallback(
    (delta: number) => {
      setLightboxIndex((ix) => {
        if (ix == null || queue.length === 0) return ix;
        const next = (ix + delta + queue.length) % queue.length;
        return next;
      });
    },
    [queue.length],
  );

  useEffect(() => {
    if (lightboxIndex == null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') moveLightbox(-1);
      if (e.key === 'ArrowRight') moveLightbox(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeLightbox, lightboxIndex, moveLightbox]);

  const getDraft = useCallback(
    (r: S3MeterReading) => {
      if (drafts[r.id] !== undefined) return drafts[r.id];
      return String(r.expectedValue ?? '').replace(/\D/g, '').slice(0, 4);
    },
    [drafts],
  );

  const setDraft = useCallback((id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value.replace(/\D/g, '').slice(0, 4) }));
  }, []);

  const saveLabel = useCallback(
    async (r: S3MeterReading): Promise<boolean> => {
      const digits = normalizeFourDigitReading(getDraft(r));
      if (!digits) {
        window.alert('Enter exactly 4 digits.');
        return false;
      }
      if (!r.s3SessionPrefix) {
        window.alert('Missing session prefix.');
        return false;
      }
      setSavingId(r.id);
      try {
        const fresh = await patchSessionMetadata(
          r.id,
          workType,
          {
            s3SessionPrefix: r.s3SessionPrefix,
            patch: {
              user_correction: digits,
              ml_prediction: digits,
              ml_raw_prediction: digits,
              is_manually_reviewed: true,
              is_correct: true,
            },
          },
          userEmail || undefined,
          portalWorkMode,
        );
        upsertReading(fresh);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[r.id];
          return next;
        });
        return true;
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Save failed');
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [getDraft, portalWorkMode, upsertReading, userEmail, workType],
  );

  const saveLabelAndNext = useCallback(async () => {
    if (!lightboxReading) return;
    const ok = await saveLabel(lightboxReading);
    if (ok && queue.length > 1) moveLightbox(1);
  }, [lightboxReading, moveLightbox, queue.length, saveLabel]);

  return (
    <div className="readings-list-page manual-label-page">
      <header className="page-header">
        <div className="header-content reading-detail-header list-page-header-with-actions">
          <div className="list-page-header-lead">
          <button type="button" className="back-button" onClick={() => navigate('/manual-upload')}>
            <ArrowLeft size={20} />
            <span>Back to upload</span>
          </button>
          <div className="page-title">
            <ImageIcon size={32} strokeWidth={1.5} />
            <div>
              <h1>Label uploaded images</h1>
              <p>Click a photo to zoom. Type a 4-digit reading and save.</p>
            </div>
          </div>
          </div>
          <ListPageRefreshButton
            onRefresh={() => void handleListRefresh()}
            busy={refreshing || readingsLoading}
            disabled={readingsLoading}
            title="Reload manual uploads from S3"
          />
        </div>
      </header>

      <div className="readings-list-filter-toolbar manual-label-filters">
        <div className="readings-list-filter-toolbar-head">
          <SlidersHorizontal size={16} aria-hidden />
          <span>Filters</span>
          <span className="manual-label-filter-count">
            {queue.length} shown
            {readingsLoading ? ' · loading…' : ''}
          </span>
        </div>

        <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort">
          <span className="readings-list-filter-label">Status</span>
          <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
            <button
              type="button"
              className={`readings-list-filter-chip${statusFilter === 'new' ? ' active' : ''}`}
              onClick={() => setStatusFilter('new')}
              aria-pressed={statusFilter === 'new'}
            >
              New ({counts.new})
            </button>
            <button
              type="button"
              className={`readings-list-filter-chip${statusFilter === 'reviewed' ? ' active' : ''}`}
              onClick={() => setStatusFilter('reviewed')}
              aria-pressed={statusFilter === 'reviewed'}
            >
              Reviewed ({counts.reviewed})
            </button>
            <button
              type="button"
              className={`readings-list-filter-chip${statusFilter === 'all' ? ' active' : ''}`}
              onClick={() => setStatusFilter('all')}
              aria-pressed={statusFilter === 'all'}
            >
              All ({counts.all})
            </button>
          </div>
        </div>

        <div className="readings-list-filter-toolbar-row">
          <span className="readings-list-filter-label">Uploaded</span>
          <div className="readings-list-filter-chips">
            <button
              type="button"
              className={`readings-list-filter-chip${!datePreset ? ' active' : ''}`}
              onClick={() => setDatePreset('')}
              aria-pressed={!datePreset}
            >
              All time
            </button>
            {DATE_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                className={`readings-list-filter-chip${datePreset === id ? ' active' : ''}`}
                onClick={() => setDatePreset(id)}
                aria-pressed={datePreset === id}
              >
                {formatPresetLabel(id)}
              </button>
            ))}
          </div>
        </div>

        <div className="manual-label-filters-actions">
          <button type="button" className="manual-upload-secondary-btn" onClick={() => navigate('/manual-upload')}>
            <Upload size={16} aria-hidden />
            Upload more
          </button>
        </div>
      </div>

      {readingsLoading && queue.length === 0 ? (
        <ListViewLoading message="Loading uploaded images…" />
      ) : null}

      {readingsLoading && queue.length > 0 ? (
        <ListViewLoading variant="inline" message="Refreshing uploads…" />
      ) : null}

      {!readingsLoading && queue.length === 0 ? (
        <p className="pipeline-iterations-empty">
          {statusFilter === 'new'
            ? 'No new uploads match these filters.'
            : statusFilter === 'reviewed'
              ? 'No reviewed uploads match these filters.'
              : 'No manual uploads match these filters.'}
        </p>
      ) : null}

      <div className="manual-label-grid">
        {queue.map((r, index) => {
          const url = thumbUrl(r);
          const draft = getDraft(r);
          const labeled = isReviewed(r);
          const busy = savingId === r.id;
          const day = formatReadingShortDate(r.dateOfReading || '');

          return (
            <article
              key={r.id}
              className={`manual-label-card ${labeled ? 'manual-label-card--done' : 'manual-label-card--new'}`}
            >
              <button
                type="button"
                className="manual-label-card-media"
                disabled={!url}
                aria-label="Open full-size image"
                onClick={() => setLightboxIndex(index)}
              >
                {url ? (
                  <img src={url} alt="" className="manual-label-card-img" loading="lazy" />
                ) : (
                  <div className="manual-label-card-img manual-label-card-img--empty">No preview</div>
                )}
                {url ? (
                  <span className="manual-label-zoom-badge">
                    <Maximize2 size={14} aria-hidden />
                    Zoom
                  </span>
                ) : null}
              </button>

              <div className="manual-label-card-meta">
                <span className={`manual-label-status-pill ${labeled ? 'is-reviewed' : 'is-new'}`}>
                  {labeled ? 'Reviewed' : 'New'}
                </span>
                {day ? <span className="manual-label-date">{day}</span> : null}
              </div>

              <div className="manual-label-card-body">
                {labeled ? (
                  <p className="manual-label-done">
                    <Check size={16} aria-hidden />
                    <span className="manual-label-done-value">
                      {String(r.expectedValue ?? '').replace(/\D/g, '')}
                    </span>
                  </p>
                ) : (
                  <>
                    <label className="manual-label-input-wrap">
                      <span className="manual-label-input-label">Reading</span>
                      <input
                        className="manual-label-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        placeholder="0000"
                        value={draft}
                        disabled={busy}
                        aria-label="Correct 4-digit reading"
                        onChange={(e) => setDraft(r.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveLabel(r);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="manual-label-save-btn"
                      disabled={busy || draft.length !== 4}
                      onClick={() => void saveLabel(r)}
                    >
                      {busy ? <Loader2 size={16} className="spin" aria-hidden /> : null}
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="training-hub-text-btn manual-label-open-detail"
                  onClick={() =>
                    navigate(`/reading/${encodeURIComponent(r.id)}`, {
                      state: { listReturn: { pathname: '/manual-upload/label' } },
                    })
                  }
                >
                  Full review →
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {lightboxUrl && lightboxIndex != null && lightboxReading ? (
        <ManualLabelLightbox
          reading={lightboxReading}
          imageUrl={lightboxUrl}
          index={lightboxIndex}
          total={queue.length}
          draft={getDraft(lightboxReading)}
          reviewed={isReviewed(lightboxReading)}
          saving={savingId === lightboxReading.id}
          onDraftChange={(v) => setDraft(lightboxReading.id, v)}
          onSave={() => void saveLabel(lightboxReading)}
          onSaveAndNext={() => void saveLabelAndNext()}
          onClose={closeLightbox}
          onPrev={() => moveLightbox(-1)}
          onNext={() => moveLightbox(1)}
          canPrev={queue.length > 1}
          canNext={queue.length > 1}
        />
      ) : null}
    </div>
  );
};

export default ManualUploadLabelPage;
