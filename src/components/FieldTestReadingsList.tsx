import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronDown,
  ChevronUp,
  Eye,
  ImageIcon,
  MapPin,
  Search,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import CaptureViewModeToggle from './CaptureViewModeToggle';
import { CaptureMapViewKeepAlive } from './CaptureMapView';
import { useCaptureViewMode } from '../hooks/useCaptureViewMode';
import {
  fetchFieldTestCaptures,
  fetchFieldTestCycles,
  type FieldTestCycle,
  type FieldTestReadingsListResponse,
  type S3MeterReading,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canViewFieldTestImages } from '../utils/portalWorkMode';
import { useAuth } from '../context/AuthContext';
import { useReadings } from '../context/ReadingsContext';
import { useMergeContextReadingUpserts } from '../hooks/useMergeContextReadingUpserts';
import { useMyAssignmentOrder } from '../hooks/useMyAssignmentOrder';
import AssignedToMeToggle from './AssignedToMeToggle';
import {
  assignmentAssignParamActive,
  filterAssignedToUser,
  sortReadingsByAssignmentOrder,
} from '../utils/reviewAssignments';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import { captureLocationListLine } from '../utils/captureLocation';
import { formatReadingDateTime, formatReadingShortDate } from '../utils/readingDisplayDates';
import { fieldTestReviewerCorrectionMeta } from '../utils/fieldTestCorrectionMeta';
import {
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  type DateRangePresetId,
} from '../utils/dateRangePresets';
import {
  isPortalManualReviewFilterId,
  matchesPortalManualReviewFilter,
  normalizePortalManualReviewStatus,
  portalManualReviewListBadge,
  PORTAL_MANUAL_REVIEW_FILTER_IDS,
  PORTAL_MANUAL_REVIEW_LABELS,
  type PortalManualReviewFilterId,
} from '../utils/portalManualReview';
import { formatSessionIdTimestampForList } from '../utils/sessionDisplay';
import { getReadingListStatusDisplay, isAwaitingReviewerReview } from '../types';
import {
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS,
  type FieldTestCaptureFilters,
  fieldTestFiltersActive,
  filterFieldTestReadings,
} from '../utils/fieldTestImageFilters';
import { buildFieldTestCityOptions } from '../utils/fieldTestLocation';
import { readingMatchesDateRangeWindow } from '../utils/fieldTestReadings';
import FieldTestCycleFilterSelect from './FieldTestCycleFilterSelect';
import {
  FIELD_TEST_ALL_CYCLES,
  fieldTestCycleForDisplay,
  fieldTestCycleIdForApi,
  fieldTestCycleScopeLabel,
  fieldTestCycleSelectValue,
  fieldTestDefaultsToAllCycles,
} from '../utils/fieldTestCycleFilter';

const DATE_PRESET_IDS: DateRangePresetId[] = ['today', 'yesterday', 'last7', 'last30'];

const SEARCH_DEBOUNCE_MS = 350;
const FIELD_TEST_VIEW_MODE_KEY = 'portal.fieldTest.viewMode';
const FIELD_TEST_FILTERS_EXPANDED_KEY = 'portal.fieldTest.listFiltersExpanded';

const FIELD_TEST_REVIEW_COHORT_IDS = ['untrained', 'correct', 'incorrect'] as const;
const FIELD_TEST_DATASET_COHORT_IDS = ['training', 'test_data'] as const;
const FIELD_TEST_COHORT_IDS = [
  ...FIELD_TEST_REVIEW_COHORT_IDS,
  ...FIELD_TEST_DATASET_COHORT_IDS,
] as const;
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
  const { userEmail } = useAuth();
  const portalWorkMode = outletCtx?.workMode ?? 'reviewer';
  const assignFilterActive = assignmentAssignParamActive(searchParams);
  const { batches: myBatches, orderIds: assignmentOrderIds } = useMyAssignmentOrder(
    'field_test',
    workType,
    userEmail,
    portalWorkMode,
    assignFilterActive,
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cycles, setCycles] = useState<FieldTestCycle[]>([]);
  const [activeCycle, setActiveCycle] = useState<FieldTestCycle | null>(null);
  const [allReadings, setAllReadings] = useState<S3MeterReading[]>([]);
  const { mergeWithContext } = useMergeContextReadingUpserts(setAllReadings);
  const [refreshing, setRefreshing] = useState(false);
  const [cyclesResolved, setCyclesResolved] = useState(false);
  const [filters, setFilters] = useState<Omit<FieldTestCaptureFilters, 'datePreset'>>({
    query: '',
    difficulty: 'all',
    user: 'all',
    corrected: 'all',
    location: 'all',
    captureTrigger: 'all',
    sortDir: 'desc',
  });
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [viewMode, setViewMode] = useCaptureViewMode(FIELD_TEST_VIEW_MODE_KEY);
  const [filtersExpanded, setFiltersExpanded] = useState(() => {
    try {
      return localStorage.getItem(FIELD_TEST_FILTERS_EXPANDED_KEY) !== '0';
    } catch {
      return true;
    }
  });

  const cycleIdParam = searchParams.get('cycleId') || '';
  const cohortParamRaw = (searchParams.get('cohort') || '').trim().toLowerCase();
  const activeCohort: FieldTestCohortId | null = isFieldTestCohortId(cohortParamRaw) ? cohortParamRaw : null;
  const rangePresetRaw = (searchParams.get('range') || '').trim();
  const rangePreset: DateRangePresetId | '' = isDateRangePresetId(rangePresetRaw) ? rangePresetRaw : '';
  const portalManualReviewRaw = (searchParams.get('portalManualReview') || '').trim().toLowerCase();
  const activePortalManualReview: PortalManualReviewFilterId | null = isPortalManualReviewFilterId(
    portalManualReviewRaw,
  )
    ? portalManualReviewRaw
    : null;
  const presetWindow = rangePreset ? getDateRangeFromPreset(rangePreset) : null;
  const defaultToAllCycles = fieldTestDefaultsToAllCycles(portalWorkMode);
  const cycleSelectValue = fieldTestCycleSelectValue(cycleIdParam, activeCycle, defaultToAllCycles);
  const apiCycleId = fieldTestCycleIdForApi(cycleSelectValue);
  const displayCycle = fieldTestCycleForDisplay(cycles, cycleSelectValue);
  const captureReady = cyclesResolved;

  useEffect(() => {
    if (!outletCtx?.workMode || !canViewFieldTestImages(outletCtx.workMode)) {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(filters.query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filters.query]);

  useEffect(() => {
    try {
      localStorage.setItem(FIELD_TEST_FILTERS_EXPANDED_KEY, filtersExpanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [filtersExpanded]);

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

  const captureCycleKey = apiCycleId ?? FIELD_TEST_ALL_CYCLES;

  const loadCaptures = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (!captureReady) return;

      setErr(null);
      try {
        const res = (await fetchFieldTestCaptures(workType, {
          cycleId: apiCycleId,
          page: 1,
          limit: 2000,
          format: 'readings',
          datePreset: 'all',
          refresh: opts?.refresh,
        })) as FieldTestReadingsListResponse;

        setAllReadings(mergeWithContext(res.readings));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load field test captures');
      } finally {
        setInitialLoading(false);
      }
    },
    [
      workType,
      apiCycleId,
      captureCycleKey,
      captureReady,
      mergeWithContext,
    ],
  );

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadCycles(), loadCaptures({ refresh: true })]);
    } finally {
      setRefreshing(false);
    }
  };

  const onCycleChange = (id: string) => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      if (id === FIELD_TEST_ALL_CYCLES) n.set('cycleId', FIELD_TEST_ALL_CYCLES);
      else if (id) n.set('cycleId', id);
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

  const setPortalManualReviewParam = (next: PortalManualReviewFilterId | null) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!next) n.delete('portalManualReview');
        else n.set('portalManualReview', next);
        return n;
      },
      { replace: true },
    );
  };

  const clearDateRangeFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('date');
        n.delete('from');
        n.delete('to');
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
          n.delete('date');
          n.delete('from');
          n.delete('to');
          n.set('range', preset);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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

  const filteredReadings = useMemo(() => {
    let list = allReadings.filter((r) => readingMatchesDateRangeWindow(r, presetWindow));
    list = filterFieldTestReadings(list, filterInput);
    if (activeCohort) {
      list = list.filter((r) => matchesFieldTestCohort(r, activeCohort));
    }
    if (activePortalManualReview) {
      list = list.filter((r) => matchesPortalManualReviewFilter(r, activePortalManualReview));
    }
    list = [...list].sort((a, b) => {
      const cmp = String(b.dateOfReading || b.createdAt || '').localeCompare(
        String(a.dateOfReading || a.createdAt || ''),
      );
      return filters.sortDir === 'desc' ? cmp : -cmp;
    });
    return list;
  }, [allReadings, presetWindow, filterInput, activeCohort, activePortalManualReview, filters.sortDir]);

  const setAssignFilter = useCallback(
    (active: boolean) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (active) n.set('assign', 'me');
          else n.delete('assign');
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const assignedToMeCount = useMemo(
    () => filterAssignedToUser(filteredReadings, userEmail).length,
    [filteredReadings, userEmail],
  );

  const displayReadings = useMemo(() => {
    let list = filteredReadings;
    if (assignFilterActive) {
      list = filterAssignedToUser(list, userEmail);
      if (assignmentOrderIds.length > 0) {
        list = sortReadingsByAssignmentOrder(list, assignmentOrderIds);
      }
    }
    return list;
  }, [filteredReadings, assignFilterActive, userEmail, assignmentOrderIds]);

  const assignmentRemaining = useMemo(() => {
    if (!assignFilterActive || myBatches.length === 0) return null;
    return myBatches.reduce((n, b) => n + (b.myProgress?.remaining ?? 0), 0);
  }, [assignFilterActive, myBatches]);

  const filtersActive = fieldTestFiltersActive(filterInput) || Boolean(rangePreset);
  const filtersPanelActive =
    filtersActive || assignFilterActive || Boolean(activeCohort) || Boolean(activePortalManualReview);
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

  const toggleDateSort = () => {
    setFilters((prev) => ({
      ...prev,
      sortDir: prev.sortDir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const openReading = useCallback(
    (reading: S3MeterReading) => {
      const sp = new URLSearchParams(searchParams);
      sp.set('workType', workType);
      navigate(
        {
          pathname: `/reading/${encodeURIComponent(reading.id)}`,
          search: sp.toString() ? `?${sp.toString()}` : '',
        },
        {
          state: {
            readingQueueIds: displayReadings.map((r) => r.id),
            listReturn: { pathname: location.pathname, search: location.search },
          },
        },
      );
    },
    [navigate, searchParams, workType, displayReadings, location.pathname, location.search],
  );

  const countLabel = useMemo(() => {
    if (initialLoading && allReadings.length === 0) return 'Loading…';
    const cyclePart = cycles.length > 0 ? ` · ${fieldTestCycleScopeLabel(cycleSelectValue, displayCycle)}` : '';
    const visibleCount = displayReadings.length;
    const loadedCount = allReadings.length;
    const countText =
      visibleCount !== loadedCount
        ? `${visibleCount.toLocaleString()} of ${loadedCount.toLocaleString()}`
        : visibleCount.toLocaleString();
    const base = `${countText} capture${visibleCount === 1 ? '' : 's'}${cyclePart}`;
    const cohortPart = activeCohort ? ` · ${FIELD_TEST_COHORT_LABELS[activeCohort]}` : '';
    const portalReviewPart = activePortalManualReview
      ? ` · ${PORTAL_MANUAL_REVIEW_LABELS[activePortalManualReview]}`
      : '';
    const datePart = rangePreset ? ` · ${formatPresetLabel(rangePreset)}` : '';
    const busyPart = refreshing ? ' · updating…' : '';
    return `${base}${cohortPart}${portalReviewPart}${datePart}${busyPart}`;
  }, [
    initialLoading,
    refreshing,
    allReadings.length,
    displayReadings.length,
    assignFilterActive,
    cycleSelectValue,
    displayCycle,
    cycles.length,
    activeCohort,
    activePortalManualReview,
    rangePreset,
  ]);

  const toolbarBusy = refreshing;

  return (
    <div className="readings-list-page field-test-readings-list-page">
      <header className="page-header field-test-readings-page-header">
        <div className="field-test-readings-header-inner">
          <div className="header-content list-page-header-with-actions">
            <div className="list-page-header-lead">
              <div className="page-title">
                <ImageIcon size={32} strokeWidth={1.5} />
                <div>
                  <h1>Images</h1>
                  <p aria-live="polite">{countLabel}</p>
                </div>
              </div>
            </div>
            <div className="field-test-readings-header-actions">
              <button
                type="button"
                className="field-test-filters-toggle"
                onClick={() => setFiltersExpanded((open) => !open)}
                aria-expanded={filtersExpanded}
                aria-controls="field-test-readings-filters"
              >
                <SlidersHorizontal size={16} aria-hidden />
                <span>{filtersExpanded ? 'Hide filters' : 'Show filters'}</span>
                {filtersPanelActive ? (
                  <span className="field-test-advanced-filters-active-dot" aria-label="Filters active" />
                ) : null}
                {filtersExpanded ? (
                  <ChevronUp size={16} aria-hidden />
                ) : (
                  <ChevronDown size={16} aria-hidden />
                )}
              </button>
              <ListPageRefreshButton
                variant="icon"
                onRefresh={() => void handleRefresh()}
                busy={toolbarBusy}
                disabled={initialLoading && allReadings.length === 0}
                title="Refresh field test list"
              />
            </div>
          </div>

          {!err ? (
            <>
            {!filtersExpanded && filtersPanelActive ? (
              <p className="field-test-filters-collapsed-hint">
                Filters are applied — expand to change assignment, search, status, or dates.
              </p>
            ) : null}
            {filtersExpanded ? (
            <div id="field-test-readings-filters" className="field-test-readings-filters-panel">
            <div
              className={`unit-test-images-filter-toolbar field-test-images-filter-toolbar field-test-readings-filter-toolbar${toolbarBusy ? ' field-test-readings-filter-toolbar--busy' : ''}`}
            >
              <AssignedToMeToggle
                active={assignFilterActive}
                onChange={setAssignFilter}
                assignedCount={assignedToMeCount}
                totalCount={filteredReadings.length}
                progressRemaining={assignmentRemaining}
              />
              <FieldTestCycleFilterSelect
                cycles={cycles}
                value={cycleSelectValue}
                onChange={onCycleChange}
              />
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
                  <option value="yes">Corrected</option>
                  <option value="no">No correction</option>
                </select>
              </label>
              {filtersActive ? (
                <button type="button" className="unit-test-images-filter-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>
            <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort field-test-readings-review-row">
              <SlidersHorizontal size={16} aria-hidden />
              <span className="readings-list-filter-label">Review</span>
              <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
                <button
                  type="button"
                  className={`readings-list-filter-chip${!activeCohort ? ' active' : ''}`}
                  onClick={() => setCohortParam(null)}
                  aria-pressed={!activeCohort}
                >
                  All
                </button>
                {FIELD_TEST_REVIEW_COHORT_IDS.map((id) => (
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
            <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort field-test-readings-dataset-row">
              <span className="readings-list-filter-label">Dataset</span>
              <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
                {FIELD_TEST_DATASET_COHORT_IDS.map((id) => (
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
            <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-cohort field-test-readings-portal-review-row">
              <span className="readings-list-filter-label">Portal review</span>
              <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
                <button
                  type="button"
                  className={`readings-list-filter-chip${!activePortalManualReview ? ' active' : ''}`}
                  onClick={() => setPortalManualReviewParam(null)}
                  aria-pressed={!activePortalManualReview}
                >
                  All
                </button>
                {PORTAL_MANUAL_REVIEW_FILTER_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`readings-list-filter-chip${activePortalManualReview === id ? ' active' : ''}`}
                    onClick={() =>
                      setPortalManualReviewParam(activePortalManualReview === id ? null : id)
                    }
                    aria-pressed={activePortalManualReview === id}
                  >
                    {PORTAL_MANUAL_REVIEW_LABELS[id]}
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
            </div>
            ) : null}
            <div className="readings-list-filter-toolbar-row field-test-readings-view-mode-row">
              <CaptureViewModeToggle mode={viewMode} onChange={setViewMode} />
              {viewMode === 'map' ? (
                <span className="field-test-view-mode-hint">
                  Tap a pin for captures at that spot · same filters as list
                </span>
              ) : null}
            </div>
            </>
          ) : null}
        </div>
      </header>

      <main className="list-content field-test-readings-list-content">
        {initialLoading && allReadings.length === 0 ? (
          <ListViewLoading message="Loading field test captures…" />
        ) : null}
        {refreshing && allReadings.length > 0 ? (
          <ListViewLoading variant="inline" message="Updating list…" />
        ) : null}
        {err ? <p className="unit-test-images-page-message training-hub-inline-error">{err}</p> : null}

        {!refreshing && !initialLoading && !err && displayReadings.length === 0 ? (
          <p className="unit-test-images-page-message pipeline-iterations-empty">
            {allReadings.length === 0
              ? 'No field captures yet. Open a capture to set correct/incorrect and image difficulty.'
              : 'No captures match the current filters. Try another date, clear filters, or choose All.'}
          </p>
        ) : null}

        {displayReadings.length > 0 ? (
          <CaptureMapViewKeepAlive
            active={viewMode === 'map'}
            readings={displayReadings}
            onSelectReading={openReading}
          />
        ) : null}

        {displayReadings.length > 0 && viewMode === 'list' ? (
          <div className={`table-container${refreshing ? ' table-container--refreshing' : ''}`}>
            <table className="readings-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Difficulty</th>
                  <th>Outcome</th>
                  <th>Portal review</th>
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
                  <th className="readings-col-session-id">Capture ID</th>
                  <th>Captured by</th>
                  <th>Corrected by</th>
                  <th className="readings-th-meter-value">Meter value</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayReadings.map((reading) => {
                  const { label, color } = getReadingListStatusDisplay(reading);
                  const correction = fieldTestReviewerCorrectionMeta(reading);
                  const portalReviewStatus = normalizePortalManualReviewStatus(
                    reading.portalManualReviewStatus,
                  );
                  const portalReview = portalManualReviewListBadge(portalReviewStatus);
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
                          {correction.isCorrected ? (
                            <span className="field-test-corrected-pill">Corrected</span>
                          ) : null}
                        </span>
                      </td>
                      <td data-label="Portal review">
                        <span className="readings-status-cell">
                          <span
                            className="status-badge"
                            style={{
                              backgroundColor: `${portalReview.color}20`,
                              color: portalReview.color,
                              borderColor: portalReview.color,
                            }}
                            title={
                              [
                                portalReview.fullLabel,
                                reading.portalManualReviewedBy
                                  ? `${reading.portalManualReviewedBy}${
                                      reading.portalManualReviewedAt
                                        ? ` · ${formatReadingDateTime(reading.portalManualReviewedAt)}`
                                        : ''
                                    }`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || undefined
                            }
                          >
                            {portalReview.label}
                          </span>
                        </span>
                      </td>
                      <td data-label="Date">
                        <div className="cell-with-icon">
                          <Calendar size={16} className="cell-icon" aria-hidden />
                          <span>{formatReadingShortDate(reading.dateOfReading)}</span>
                        </div>
                      </td>
                      <td className="readings-col-session-id" data-label="Capture ID">
                        <code
                          className="readings-session-id-cell"
                          title={reading.id}
                        >
                          {formatSessionIdTimestampForList(reading.id)}
                        </code>
                      </td>
                      <td data-label="Captured by">
                        <div className="cell-with-icon readings-col-captured">
                          <User size={16} className="cell-icon" aria-hidden />
                          <span className="readings-col-captured-text" title={reading.userName || undefined}>
                            {reading.userName?.trim() ? reading.userName : '—'}
                          </span>
                        </div>
                      </td>
                      <td data-label="Corrected by">
                        {correction.correctedBy ? (
                          <div className="field-test-correction-cell">
                            <span className="field-test-correction-cell-by" title={correction.correctedBy}>
                              {correction.correctedBy}
                            </span>
                            {correction.correctedAt ? (
                              <time
                                className="field-test-correction-cell-at"
                                dateTime={correction.correctedAt}
                                title={correction.correctedAt}
                              >
                                {formatReadingDateTime(correction.correctedAt)}
                              </time>
                            ) : null}
                          </div>
                        ) : correction.correctedOnDevice ? (
                          <span className="field-test-correction-cell-device">On device</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="readings-td-meter-value" data-label="Meter value">
                        <span className="meter-value">{reading.meterValue}</span>
                      </td>
                      <td data-label="Actions">
                        <button className="view-button" onClick={() => openReading(reading)}>
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
