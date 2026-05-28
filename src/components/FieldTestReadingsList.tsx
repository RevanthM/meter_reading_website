import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import { Calendar, ClipboardList, Eye, MapPin, Search, SlidersHorizontal, User, X, ArrowDown, ArrowUp } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import {
  fetchFieldTestCaptures,
  fetchFieldTestCycles,
  type FieldTestCityFilterOption,
  type FieldTestCycle,
  type FieldTestReadingsListResponse,
  type S3MeterReading,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canViewFieldTestImages } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import { captureLocationListLine } from '../utils/captureLocation';
import { formatReadingShortDate } from '../utils/readingDisplayDates';
import { formatPresetLabel, type DateRangePresetId } from '../utils/dateRangePresets';
import { getReadingListStatusDisplay, isAwaitingReviewerReview } from '../types';
import {
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS,
  type FieldTestCaptureFilters,
  fieldTestFiltersActive,
} from '../utils/fieldTestImageFilters';

const DEFAULT_FILTERS: FieldTestCaptureFilters = {
  query: '',
  difficulty: 'all',
  user: 'all',
  corrected: 'all',
  location: 'all',
  captureTrigger: 'all',
  datePreset: 'all',
  sortDir: 'desc',
};

const DATE_PRESET_IDS: DateRangePresetId[] = ['today', 'yesterday', 'last7', 'last30'];

const SEARCH_DEBOUNCE_MS = 350;

const FIELD_TEST_COHORT_IDS = ['untrained', 'correct', 'incorrect', 'training', 'test_data'] as const;
type FieldTestCohortId = (typeof FIELD_TEST_COHORT_IDS)[number];

const FIELD_TEST_COHORT_LABELS: Record<FieldTestCohortId, string> = {
  untrained: 'Awaiting review',
  correct: 'Reviewed correct',
  incorrect: 'Reviewed incorrect',
  training: 'Send to training',
  test_data: 'Send to test dataset',
};

function isFieldTestCohortId(s: string): s is FieldTestCohortId {
  return (FIELD_TEST_COHORT_IDS as readonly string[]).includes(s);
}

function matchesFieldTestCohort(r: S3MeterReading, cohort: FieldTestCohortId): boolean {
  switch (cohort) {
    case 'untrained':
      return isAwaitingReviewerReview(r);
    case 'correct':
      return r.status === 'correct';
    case 'incorrect':
      return (
        r.status === 'incorrect_analyzed' ||
        r.status === 'incorrect_labeled' ||
        r.status === 'incorrect_training' ||
        (r.status === 'incorrect_new' && r.isManuallyReviewed === true)
      );
    case 'training':
      return (
        r.status !== 'incorrect_training' &&
        (r.reviewerDatasetDestination === 'training' || r.reviewerRecommendTraining === true)
      );
    case 'test_data':
      return r.reviewerDatasetDestination === 'test';
  }
}

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

function locationCell(reading: S3MeterReading): string {
  return captureLocationListLine(reading.captureLocation) || reading.location || '—';
}

const FieldTestReadingsList: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cycles, setCycles] = useState<FieldTestCycle[]>([]);
  const [activeCycle, setActiveCycle] = useState<FieldTestCycle | null>(null);
  const [readings, setReadings] = useState<S3MeterReading[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [cities, setCities] = useState<FieldTestCityFilterOption[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FieldTestCaptureFilters>(DEFAULT_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const cycleId = searchParams.get('cycleId') || activeCycle?.id || '';
  const cohortParamRaw = (searchParams.get('cohort') || '').trim().toLowerCase();
  const activeCohort: FieldTestCohortId | null = isFieldTestCohortId(cohortParamRaw) ? cohortParamRaw : null;
  const showCyclePicker =
    outletCtx?.workMode !== 'reviewer' && outletCtx?.workMode !== 'test_data_reviewer';

  useEffect(() => {
    if (!outletCtx?.workMode || !canViewFieldTestImages(outletCtx.workMode)) {
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
        cyclesRes.cycles.find((c) => c.id === cycleId) ||
        cyclesRes.activeCycle ||
        cyclesRes.cycles[0] ||
        null;
      setActiveCycle(selected);
      return selected;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load field test cycles');
      return null;
    }
  }, [workType, cycleId]);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  const effectiveCycleId = cycleId || activeCycle?.id || '';

  const loadCaptures = useCallback(
    async (opts?: { refresh?: boolean }) => {
      setFetching(true);
      setErr(null);
      try {
        const res = (await fetchFieldTestCaptures(workType, {
          cycleId: showCyclePicker ? effectiveCycleId || undefined : undefined,
          page: 1,
          limit: 2000,
          format: 'readings',
          q: debouncedQuery,
          difficulty: filters.difficulty,
          user: filters.user,
          corrected: filters.corrected,
          location: filters.location,
          captureTrigger: filters.captureTrigger,
          datePreset: filters.datePreset,
          sortDir: filters.sortDir,
          refresh: opts?.refresh,
        })) as FieldTestReadingsListResponse;

        setReadings(res.readings);
        setUsers(res.filterOptions.users);
        setCities(res.filterOptions.cities ?? []);
        setTotal(res.total);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load field test captures');
      } finally {
        setFetching(false);
        setInitialLoading(false);
      }
    },
    [
      workType,
      showCyclePicker,
      effectiveCycleId,
      debouncedQuery,
      filters.difficulty,
      filters.user,
      filters.corrected,
      filters.location,
      filters.captureTrigger,
      filters.datePreset,
      filters.sortDir,
    ],
  );

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCycles();
      await loadCaptures({ refresh: true });
    } finally {
      setRefreshing(false);
    }
  };

  const onCycleChange = (id: string) => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set('cycleId', id);
      else n.delete('cycleId');
      return n;
    });
  };

  const setCohortParam = (next: FieldTestCohortId | null) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!next) n.delete('cohort');
        else n.set('cohort', next);
        return n;
      },
      { replace: true },
    );
  };

  const filteredReadings = useMemo(() => {
    if (!activeCohort) return readings;
    return readings.filter((r) => matchesFieldTestCohort(r, activeCohort));
  }, [readings, activeCohort]);

  const filtersActive = fieldTestFiltersActive(filters);
  const clearFilters = () => setFilters({ ...DEFAULT_FILTERS });

  const toggleDateSort = () => {
    setFilters((prev) => ({
      ...prev,
      sortDir: prev.sortDir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const setDatePreset = (preset: DateRangePresetId) => {
    setFilters((prev) => ({
      ...prev,
      datePreset: prev.datePreset === preset ? 'all' : preset,
    }));
  };

  const countLabel = useMemo(() => {
    if (initialLoading && readings.length === 0) return 'Loading…';
    const cyclePart = showCyclePicker && activeCycle ? ` · ${activeCycle.name}` : '';
    const visibleCount = filteredReadings.length;
    const loadedCount = readings.length;
    const countText =
      activeCohort && visibleCount !== loadedCount
        ? `${visibleCount.toLocaleString()} of ${(total || loadedCount).toLocaleString()}`
        : (total || visibleCount).toLocaleString();
    const base = `${countText} capture${visibleCount === 1 && !activeCohort ? '' : 's'}${cyclePart}`;
    const cohortPart = activeCohort ? ` · ${FIELD_TEST_COHORT_LABELS[activeCohort]}` : '';
    return fetching ? `${base}${cohortPart} · updating…` : `${base}${cohortPart}`;
  }, [
    initialLoading,
    fetching,
    total,
    readings.length,
    filteredReadings.length,
    activeCycle,
    showCyclePicker,
    activeCohort,
  ]);

  const toolbarBusy = fetching || refreshing;

  return (
    <div className="readings-list-page field-test-readings-list-page">
      <header className="page-header field-test-readings-page-header">
        <div className="field-test-readings-header-inner">
          <div className="header-content list-page-header-with-actions">
            <div className="list-page-header-lead">
              <div className="page-title">
                <ClipboardList size={32} strokeWidth={1.5} />
                <div>
                  <h1>Field test</h1>
                  <p aria-live="polite">{countLabel}</p>
                </div>
              </div>
            </div>
            <ListPageRefreshButton
              variant="icon"
              onRefresh={() => void handleRefresh()}
              busy={toolbarBusy}
              disabled={initialLoading && readings.length === 0}
              title="Refresh field test list"
            />
          </div>

          {!err ? (
            <>
            <div
              className={`unit-test-images-filter-toolbar field-test-images-filter-toolbar field-test-readings-filter-toolbar${toolbarBusy ? ' field-test-readings-filter-toolbar--busy' : ''}`}
            >
              {showCyclePicker && cycles.length > 0 ? (
                <label className="unit-test-images-filter-select-wrap">
                  <span className="unit-test-images-filter-label">Cycle</span>
                  <select
                    className="unit-test-images-filter-select"
                    value={cycleId}
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
            </div>
            <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort field-test-readings-cohort-row">
              <SlidersHorizontal size={16} aria-hidden />
              <span className="readings-list-filter-label">Show</span>
              <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
                <button
                  type="button"
                  className={`readings-list-filter-chip${!activeCohort ? ' active' : ''}`}
                  onClick={() => setCohortParam(null)}
                  aria-pressed={!activeCohort}
                >
                  All
                </button>
                {FIELD_TEST_COHORT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`readings-list-filter-chip${activeCohort === id ? ' active' : ''}`}
                    onClick={() => setCohortParam(activeCohort === id ? null : id)}
                    aria-pressed={activeCohort === id}
                  >
                    {FIELD_TEST_COHORT_LABELS[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="readings-list-filter-toolbar-row field-test-readings-date-row">
              <span className="readings-list-filter-label">When captured</span>
              <div className="readings-list-filter-chips">
                {DATE_PRESET_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`readings-list-filter-chip${filters.datePreset === id ? ' active' : ''}`}
                    onClick={() => setDatePreset(id)}
                    aria-pressed={filters.datePreset === id}
                  >
                    {formatPresetLabel(id)}
                  </button>
                ))}
                {filters.datePreset !== 'all' ? (
                  <button
                    type="button"
                    className="readings-list-filter-chip readings-list-filter-chip-muted"
                    onClick={() => setFilters((p) => ({ ...p, datePreset: 'all' }))}
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

      <main className="list-content field-test-readings-list-content">
        {initialLoading && readings.length === 0 ? (
          <ListViewLoading message="Loading field test captures…" />
        ) : null}
        {fetching && readings.length > 0 ? (
          <ListViewLoading variant="inline" message="Updating list…" />
        ) : null}
        {err ? <p className="unit-test-images-page-message training-hub-inline-error">{err}</p> : null}

        {!fetching && !initialLoading && !err && filteredReadings.length === 0 ? (
          <p className="unit-test-images-page-message pipeline-iterations-empty">
            {readings.length === 0
              ? 'No field captures match your filters. Open a capture to set correct/incorrect and image difficulty.'
              : 'No field captures match this review cohort. Try another filter or open All.'}
          </p>
        ) : null}

        {filteredReadings.length > 0 ? (
          <div className={`table-container${fetching ? ' table-container--refreshing' : ''}`}>
            <table className="readings-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Difficulty</th>
                  <th>Outcome</th>
                  <th scope="col" className="readings-th-sortable">
                    <button
                      type="button"
                      className="readings-table-sort-th readings-table-sort-th--active"
                      onClick={toggleDateSort}
                      aria-pressed
                      title={
                        filters.sortDir === 'desc'
                          ? 'Sorted by date (newest first); click for oldest first'
                          : 'Sorted by date (oldest first); click for newest first'
                      }
                    >
                      <span>Date</span>
                      {filters.sortDir === 'desc' ? (
                        <ArrowDown size={14} className="readings-table-sort-icon" aria-hidden />
                      ) : (
                        <ArrowUp size={14} className="readings-table-sort-icon" aria-hidden />
                      )}
                    </button>
                  </th>
                  <th>Captured by</th>
                  <th className="readings-th-meter-value">Meter value</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReadings.map((reading) => {
                  const { label, color } = getReadingListStatusDisplay(reading);
                  return (
                    <tr key={reading.id}>
                      <td data-label="Location">
                        <div className="cell-with-icon" title={locationCell(reading)}>
                          <MapPin size={16} className="cell-icon" aria-hidden />
                          <span>{locationCell(reading)}</span>
                        </div>
                      </td>
                      <td data-label="Difficulty">
                        <span className={difficultyBadgeClass(reading.imageDifficulty)}>
                          {formatUnitTestDifficultyTag(reading.imageDifficulty)}
                        </span>
                      </td>
                      <td data-label="Outcome">
                        <span className="readings-status-cell">
                          <span
                            className="status-badge"
                            style={{
                              backgroundColor: `${color}20`,
                              color,
                              borderColor: color,
                            }}
                          >
                            {label}
                          </span>
                          {reading.reviewerRecommendTraining ||
                          reading.reviewerDatasetDestination === 'training' ? (
                            <span
                              className="readings-training-pick-badge"
                              title="Reviewer sent to training dataset"
                            >
                              Training
                            </span>
                          ) : null}
                          {reading.reviewerDatasetDestination === 'test' ? (
                            <span className="readings-training-pick-badge" title="Reviewer sent to test dataset">
                              Test
                            </span>
                          ) : null}
                          {reading.hadUserCorrection ? (
                            <span className="field-test-corrected-pill">Corrected</span>
                          ) : null}
                        </span>
                      </td>
                      <td data-label="Date">
                        <div className="cell-with-icon">
                          <Calendar size={16} className="cell-icon" aria-hidden />
                          <span>{formatReadingShortDate(reading.dateOfReading)}</span>
                        </div>
                      </td>
                      <td data-label="Captured by">
                        <div className="cell-with-icon readings-col-captured">
                          <User size={16} className="cell-icon" aria-hidden />
                          <span className="readings-col-captured-text" title={reading.userName || undefined}>
                            {reading.userName?.trim() ? reading.userName : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="readings-td-meter-value" data-label="Meter value">
                        <span className="meter-value">{reading.meterValue}</span>
                      </td>
                      <td data-label="Actions">
                        <button
                          className="view-button"
                          onClick={() => {
                            const sp = new URLSearchParams(searchParams);
                            sp.set('workType', workType);
                            navigate(
                              {
                                pathname: `/reading/${encodeURIComponent(reading.id)}`,
                                search: sp.toString() ? `?${sp.toString()}` : '',
                              },
                              {
                                state: {
                                  readingQueueIds: filteredReadings.map((r) => r.id),
                                  listReturn: { pathname: location.pathname, search: location.search },
                                },
                              },
                            );
                          }}
                        >
                          <Eye size={16} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default FieldTestReadingsList;
