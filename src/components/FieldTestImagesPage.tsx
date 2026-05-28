import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ImageIcon, Loader2, Search, X } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import FieldTestCaptureLightbox from './FieldTestCaptureLightbox';
import {
  downloadUrlAsFile,
  fetchFieldTestCaptures,
  fetchFieldTestCycles,
  presignFieldTestCaptureUrls,
  type FieldTestCaptureRow,
  type FieldTestCycle,
  type FieldTestReadingsListResponse,
  type S3MeterReading,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canViewFieldTestResults } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import {
  difficultyToCode,
  formatUnitTestDifficultyTag,
} from '../utils/unitTestImageNaming';
import {
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS,
  type FieldTestCaptureFilters,
  fieldTestFiltersActive,
  filterFieldTestReadings,
} from '../utils/fieldTestImageFilters';
import {
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from '../utils/dateRangePresets';
import { buildFieldTestCityOptions } from '../utils/fieldTestLocation';
import {
  fieldTestCaptureFromReading,
  readingMatchesDateRangeWindow,
} from '../utils/fieldTestReadings';

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

function fieldTestCaptureDisplayFileName(cap: FieldTestCaptureRow): string {
  const reading = String(cap.finalReading || cap.predictedReading || '0000')
    .replace(/\D/g, '')
    .padStart(4, '0')
    .slice(-4);
  const dialPrefix = String(cap.dialCount || 4);
  return `${dialPrefix}_${difficultyToCode(cap.imageDifficulty)}_${reading}.jpeg`;
}

const DATE_PRESET_IDS: DateRangePresetId[] = ['today', 'yesterday', 'last7', 'last30'];
const SEARCH_DEBOUNCE_MS = 350;
const CAPTURES_PAGE_LIMIT = 96;

const FieldTestImagesPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [initialLoading, setInitialLoading] = useState(true);
  const [presigning, setPresigning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cycles, setCycles] = useState<FieldTestCycle[]>([]);
  const [activeCycle, setActiveCycle] = useState<FieldTestCycle | null>(null);
  const [cyclesResolved, setCyclesResolved] = useState(false);
  const [allReadings, setAllReadings] = useState<S3MeterReading[]>([]);
  const [presignedUrls, setPresignedUrls] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const presignSeqRef = useRef(0);
  const [filters, setFilters] = useState<Omit<FieldTestCaptureFilters, 'datePreset'>>({
    query: '',
    difficulty: 'all',
    user: 'all',
    corrected: 'all',
    location: 'all',
    captureTrigger: 'all',
    sortDir: 'desc',
  });

  const cycleIdParam = searchParams.get('cycleId') || '';
  const rangePresetRaw = (searchParams.get('range') || '').trim();
  const rangePreset: DateRangePresetId | '' = isDateRangePresetId(rangePresetRaw) ? rangePresetRaw : '';
  const presetWindow = rangePreset ? getDateRangeFromPreset(rangePreset) : null;
  const effectiveCycleId = cycleIdParam || activeCycle?.id || '';
  const captureReady = cyclesResolved && Boolean(effectiveCycleId || cycles.length === 0);

  useEffect(() => {
    if (!outletCtx?.workMode) return;
    if (outletCtx.workMode === 'reviewer' || outletCtx.workMode === 'test_data_reviewer') {
      navigate('/field-test', { replace: true });
      return;
    }
    if (!canViewFieldTestResults(outletCtx.workMode)) {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(filters.query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filters.query]);

  const loadCycles = useCallback(async () => {
    try {
      const cyclesRes = await fetchFieldTestCycles(workType);
      setCycles(cyclesRes.cycles);
      const selected =
        cyclesRes.cycles.find((c) => c.id === cycleIdParam) ||
        cyclesRes.activeCycle ||
        cyclesRes.cycles[0] ||
        null;
      setActiveCycle(selected);
      return selected;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load field test cycles');
      return null;
    } finally {
      setCyclesResolved(true);
    }
  }, [workType, cycleIdParam]);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  const loadReadings = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (!captureReady) return;

      setErr(null);
      try {
        const res = (await fetchFieldTestCaptures(workType, {
          cycleId: effectiveCycleId || undefined,
          page: 1,
          limit: 2000,
          format: 'readings',
          datePreset: 'all',
          refresh: opts?.refresh,
        })) as FieldTestReadingsListResponse;

        setAllReadings(res.readings);
        setPresignedUrls({});
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load field test captures');
      } finally {
        setInitialLoading(false);
      }
    },
    [workType, effectiveCycleId, captureReady],
  );

  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  const filterInput = useMemo(
    (): FieldTestCaptureFilters => ({
      ...filters,
      query: debouncedQuery,
      datePreset: 'all',
    }),
    [filters, debouncedQuery],
  );

  const users = useMemo(
    () =>
      [...new Set(allReadings.map((r) => (r.userName || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [allReadings],
  );

  const cities = useMemo(() => buildFieldTestCityOptions(allReadings), [allReadings]);

  const filteredCaptures = useMemo(() => {
    let list = allReadings.filter((r) => readingMatchesDateRangeWindow(r, presetWindow));
    list = filterFieldTestReadings(list, filterInput);
    list = [...list].sort((a, b) => {
      const cmp = String(b.dateOfReading || b.createdAt || '').localeCompare(
        String(a.dateOfReading || a.createdAt || ''),
      );
      return filters.sortDir === 'desc' ? cmp : -cmp;
    });
    return list.map(fieldTestCaptureFromReading);
  }, [allReadings, presetWindow, filterInput, filters.sortDir]);

  const visibleCaptures = useMemo(
    () => filteredCaptures.slice(0, CAPTURES_PAGE_LIMIT),
    [filteredCaptures],
  );

  useEffect(() => {
    if (visibleCaptures.length === 0) {
      setPresignedUrls({});
      return;
    }

    const seq = ++presignSeqRef.current;
    setPresigning(true);
    void presignFieldTestCaptureUrls(visibleCaptures)
      .then((urls) => {
        if (seq !== presignSeqRef.current) return;
        setPresignedUrls(urls);
      })
      .catch(() => {
        if (seq !== presignSeqRef.current) return;
      })
      .finally(() => {
        if (seq === presignSeqRef.current) setPresigning(false);
      });
  }, [visibleCaptures]);

  useEffect(() => {
    setLightboxIndex((lb) => {
      if (lb == null) return lb;
      if (visibleCaptures.length === 0) return null;
      if (lb >= visibleCaptures.length) return visibleCaptures.length - 1;
      return lb;
    });
  }, [visibleCaptures.length]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadCycles(), loadReadings({ refresh: true })]);
    } finally {
      setRefreshing(false);
    }
  }, [loadCycles, loadReadings]);

  const onCycleChange = (id: string) => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set('cycleId', id);
      else n.delete('cycleId');
      return n;
    });
  };

  const clearDateRangeFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('range');
        return n;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const applyRangePreset = useCallback(
    (preset: DateRangePresetId) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('range', preset);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const filtersActive = fieldTestFiltersActive(filterInput) || Boolean(rangePreset);
  const clearFilters = () => {
    setFilters({
      query: '',
      difficulty: 'all',
      user: 'all',
      corrected: 'all',
      location: 'all',
      captureTrigger: 'all',
      sortDir: 'desc',
    });
    clearDateRangeFilters();
  };

  const capturesWithUrls = useMemo(
    () =>
      visibleCaptures.map((cap) => ({
        ...cap,
        url: presignedUrls[cap.sessionId] || cap.url,
      })),
    [visibleCaptures, presignedUrls],
  );

  const imageCountLabel = useMemo(() => {
    if (initialLoading && allReadings.length === 0) return 'Loading…';
    const cycleSuffix = activeCycle ? ` · ${activeCycle.name}` : '';
    const visibleCount = visibleCaptures.length;
    const filteredCount = filteredCaptures.length;
    const loadedCount = allReadings.length;
    const countText =
      filteredCount !== loadedCount || visibleCount < filteredCount
        ? `${visibleCount.toLocaleString()} of ${filteredCount.toLocaleString()}`
        : filteredCount.toLocaleString();
    const datePart = rangePreset ? ` · ${formatPresetLabel(rangePreset)}` : '';
    const busyPart = presigning ? ' · loading previews…' : refreshing ? ' · updating…' : '';
    return `${countText} ${filteredCount === 1 ? 'image' : 'images'}${cycleSuffix}${datePart}${busyPart}`;
  }, [
    initialLoading,
    allReadings.length,
    visibleCaptures.length,
    filteredCaptures.length,
    activeCycle,
    rangePreset,
    presigning,
    refreshing,
  ]);

  const openLightbox = (index: number) => {
    const cap = capturesWithUrls[index];
    if (!cap?.url && !cap?.fullMeterUrl) return;
    setLightboxIndex(index);
  };

  const handleDownloadOne = async (cap: FieldTestCaptureRow) => {
    const url = cap.url || cap.fullMeterUrl;
    if (!url) return;
    setDownloadingKey(cap.sessionId);
    try {
      await downloadUrlAsFile(url, fieldTestCaptureDisplayFileName(cap));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloadingKey(null);
    }
  };

  const toolbarBusy = refreshing;

  return (
    <div className="readings-list-page unit-test-images-page field-test-images-page">
      <header className="page-header unit-test-images-page-header field-test-readings-page-header">
        <div className="field-test-readings-header-inner">
          <div className="header-content list-page-header-with-actions">
            <div className="list-page-header-lead">
              <div className="page-title">
                <ImageIcon size={32} strokeWidth={1.5} />
                <div>
                  <h1>Field test images</h1>
                  <p aria-live="polite">{imageCountLabel}</p>
                </div>
              </div>
            </div>
            <ListPageRefreshButton
              variant="icon"
              onRefresh={() => void handleRefresh()}
              busy={toolbarBusy}
              disabled={initialLoading && allReadings.length === 0}
              title="Refresh field test images"
            />
          </div>

          {!err ? (
            <>
              <div
                className={`unit-test-images-filter-toolbar field-test-images-filter-toolbar field-test-readings-filter-toolbar${toolbarBusy ? ' field-test-readings-filter-toolbar--busy' : ''}`}
              >
                {cycles.length > 0 ? (
                  <label className="unit-test-images-filter-select-wrap">
                    <span className="unit-test-images-filter-label">Cycle</span>
                    <select
                      className="unit-test-images-filter-select"
                      value={effectiveCycleId}
                      onChange={(e) => onCycleChange(e.target.value)}
                    >
                      {cycles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.startDate} – {c.endDate})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="unit-test-images-search-field">
                  <Search size={18} className="unit-test-images-search-icon" aria-hidden />
                  <input
                    type="search"
                    placeholder="Search by reading or session…"
                    value={filters.query}
                    onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
                    aria-label="Search field test captures"
                  />
                  {filters.query ? (
                    <button
                      type="button"
                      className="unit-test-images-search-clear"
                      onClick={() => setFilters((p) => ({ ...p, query: '' }))}
                      aria-label="Clear search"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  ) : null}
                </label>
                <label className="unit-test-images-filter-select-wrap field-test-location-filter">
                  <span className="unit-test-images-filter-label">Location</span>
                  <select
                    className="unit-test-images-filter-select field-test-location-select"
                    value={filters.location}
                    onChange={(e) => setFilters((p) => ({ ...p, location: e.target.value }))}
                    aria-label="Filter by city"
                  >
                    <option value="all">All cities</option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="unit-test-images-filter-select-wrap">
                  <span className="unit-test-images-filter-label">Capture</span>
                  <select
                    className="unit-test-images-filter-select"
                    value={filters.captureTrigger}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        captureTrigger: e.target.value as FieldTestCaptureFilters['captureTrigger'],
                      }))
                    }
                    aria-label="Filter by capture type"
                  >
                    {FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="unit-test-images-filter-select-wrap">
                  <span className="unit-test-images-filter-label">Difficulty</span>
                  <select
                    className="unit-test-images-filter-select"
                    value={filters.difficulty}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        difficulty: e.target.value as FieldTestCaptureFilters['difficulty'],
                      }))
                    }
                  >
                    {UNIT_TEST_DIFFICULTY_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="unit-test-images-filter-select-wrap">
                  <span className="unit-test-images-filter-label">Taken by</span>
                  <select
                    className="unit-test-images-filter-select"
                    value={filters.user}
                    onChange={(e) => setFilters((p) => ({ ...p, user: e.target.value }))}
                  >
                    <option value="all">All users</option>
                    {users.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="unit-test-images-filter-select-wrap">
                  <span className="unit-test-images-filter-label">Corrected</span>
                  <select
                    className="unit-test-images-filter-select"
                    value={filters.corrected}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        corrected: e.target.value as FieldTestCaptureFilters['corrected'],
                      }))
                    }
                  >
                    <option value="all">All</option>
                    <option value="yes">User corrected</option>
                    <option value="no">No correction</option>
                  </select>
                </label>
                {filtersActive ? (
                  <button type="button" className="unit-test-images-filter-clear" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
                <button
                  type="button"
                  className="unit-test-images-filter-clear field-test-sort-toggle"
                  onClick={() =>
                    setFilters((p) => ({ ...p, sortDir: p.sortDir === 'desc' ? 'asc' : 'desc' }))
                  }
                  title={
                    filters.sortDir === 'desc'
                      ? 'Sorted by date (newest first); click for oldest first'
                      : 'Sorted by date (oldest first); click for newest first'
                  }
                >
                  {filters.sortDir === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
                  <span>{filters.sortDir === 'desc' ? 'Newest first' : 'Oldest first'}</span>
                </button>
              </div>
              <div className="readings-list-filter-toolbar-row field-test-readings-date-row">
                <span className="readings-list-filter-label">When captured</span>
                <div className="readings-list-filter-chips">
                  {DATE_PRESET_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`readings-list-filter-chip${rangePreset === id ? ' active' : ''}`}
                      onClick={() => applyRangePreset(id)}
                      aria-pressed={rangePreset === id}
                    >
                      {formatPresetLabel(id)}
                    </button>
                  ))}
                  {rangePreset ? (
                    <button
                      type="button"
                      className="readings-list-filter-chip readings-list-filter-chip-muted"
                      onClick={clearDateRangeFilters}
                    >
                      Clear dates
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {initialLoading && allReadings.length === 0 ? (
        <ListViewLoading message="Loading field test images…" />
      ) : null}
      {err ? <p className="unit-test-images-page-message training-hub-inline-error">{err}</p> : null}

      {!initialLoading && !err && filteredCaptures.length === 0 ? (
        <p className="unit-test-images-page-message pipeline-iterations-empty">
          {allReadings.length === 0
            ? 'No field test images yet. New iOS field uploads appear here after Dynamo sync.'
            : 'No field test images match your filters. Try another date or clear filters.'}
        </p>
      ) : null}

      {!initialLoading && capturesWithUrls.length > 0 ? (
        <div className="unit-test-images-grid unit-test-images-page-grid">
          {capturesWithUrls.map((cap, index) => {
            const downloading = downloadingKey === cap.sessionId;
            const fileName = fieldTestCaptureDisplayFileName(cap);
            const difficulty = cap.imageDifficulty || 'normal';
            return (
              <article key={cap.sessionId} className="unit-test-images-card">
                {cap.url || cap.fullMeterUrl ? (
                  <button
                    type="button"
                    className="unit-test-images-thumb-btn"
                    onClick={() => openLightbox(index)}
                    aria-label={`Open ${fileName}`}
                  >
                    <img
                      src={cap.url || cap.fullMeterUrl}
                      alt=""
                      className="unit-test-images-thumb"
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <div className="unit-test-images-thumb unit-test-images-thumb--empty">
                    {presigning ? 'Loading…' : 'No preview'}
                  </div>
                )}
                <div className="unit-test-images-card-head">
                  <span className={difficultyBadgeClass(difficulty)}>
                    {formatUnitTestDifficultyTag(difficulty)}
                  </span>
                </div>
                <p className="unit-test-images-name">
                  <code>{fileName}</code>
                </p>
                <p className="unit-test-images-expected">
                  Ground truth: <strong>{cap.finalReading ?? '—'}</strong>
                </p>
                <div className="unit-test-images-card-actions">
                  <button
                    type="button"
                    className="unit-test-images-download-btn unit-test-images-icon-btn"
                    disabled={downloading || (!cap.url && !cap.fullMeterUrl)}
                    onClick={() => void handleDownloadOne(cap)}
                    title={`Download ${fileName}`}
                    aria-label={`Download ${fileName}`}
                  >
                    {downloading ? (
                      <Loader2 size={16} className="spin" aria-hidden />
                    ) : (
                      <ArrowDown size={16} aria-hidden />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {lightboxIndex != null &&
      (capturesWithUrls[lightboxIndex]?.url || capturesWithUrls[lightboxIndex]?.fullMeterUrl) ? (
        <FieldTestCaptureLightbox
          captures={capturesWithUrls}
          index={lightboxIndex}
          workType={workType}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      ) : null}
    </div>
  );
};

export default FieldTestImagesPage;
