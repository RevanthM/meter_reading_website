import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowDown, Download, ImageIcon, Loader2, Search, Trash2, X } from 'lucide-react';
import ListPageRefreshButton from './ListPageRefreshButton';
import ListViewLoading from './ListViewLoading';
import UnitTestImageLightbox from './UnitTestImageLightbox';
import {
  deleteUnitTestImage,
  downloadUnitTestImage,
  downloadUnitTestImagesZip,
  fetchUnitTestImages,
  presignUnitTestImages,
  type UnitTestImageRow,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { canEditTestData, canViewTestData } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import {
  filterUnitTestImages,
  UNIT_TEST_DIFFICULTY_FILTER_OPTIONS,
  unitTestImageFiltersActive,
  type UnitTestImageDifficultyFilter,
  type UnitTestImageListFilters,
} from '../utils/unitTestImageFilters';

function difficultyBadgeClass(difficulty: string | null | undefined): string {
  const d = String(difficulty || 'normal').toLowerCase();
  if (d === 'difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d2';
  if (d === 'very_difficult') return 'unit-test-difficulty-badge unit-test-difficulty-badge--d3';
  return 'unit-test-difficulty-badge unit-test-difficulty-badge--d1';
}

const UnitTestImagesPage: FC = () => {
  const navigate = useNavigate();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [images, setImages] = useState<UnitTestImageRow[]>([]);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [filters, setFilters] = useState<UnitTestImageListFilters>({
    query: '',
    difficulty: 'all',
  });

  const loadImages = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchUnitTestImages(workType);
      const rows = data.images;
      if (rows.length === 0) {
        setImages([]);
        return;
      }
      const urls = await presignUnitTestImages(rows.map((img) => img.s3Key));
      setImages(rows.map((img) => ({ ...img, url: urls[img.s3Key] })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [workType]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadImages();
    } finally {
      setRefreshing(false);
    }
  }, [loadImages]);

  useEffect(() => {
    const mode = outletCtx?.workMode;
    if (!mode || !canViewTestData(mode)) {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  const canEdit = outletCtx?.workMode ? canEditTestData(outletCtx.workMode) : false;

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  useEffect(() => {
    setFilters({ query: '', difficulty: 'all' });
    setLightboxIndex(null);
  }, [workType]);

  const visibleImages = useMemo(() => filterUnitTestImages(images, filters), [images, filters]);

  useEffect(() => {
    setLightboxIndex((lb) => {
      if (lb == null) return lb;
      if (visibleImages.length === 0) return null;
      if (lb >= visibleImages.length) return visibleImages.length - 1;
      return lb;
    });
  }, [visibleImages.length, filters]);

  const handleImageUpdated = (previousS3Key: string, updated: UnitTestImageRow) => {
    setImages((prev) => {
      const next = prev.map((row) => (row.s3Key === previousS3Key ? updated : row));
      const visible = filterUnitTestImages(next, filters);
      const newIdx = visible.findIndex((row) => row.s3Key === updated.s3Key);
      setLightboxIndex((lb) => {
        if (lb == null) return lb;
        if (newIdx < 0) return null;
        return newIdx;
      });
      return next;
    });
  };

  const handleDelete = async (img: UnitTestImageRow) => {
    if (
      !window.confirm(
        `Remove ${img.fileName} from the unit test library? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingKey(img.s3Key);
    try {
      await deleteUnitTestImage(workType, img.s3Key, outletCtx?.workMode ?? 'test_data_reviewer');
      setImages((prev) => {
        const next = prev.filter((row) => row.s3Key !== img.s3Key);
        const visibleAfter = filterUnitTestImages(next, filters);
        const removedVisibleIdx = visibleImages.findIndex((row) => row.s3Key === img.s3Key);
        setLightboxIndex((lb) => {
          if (lb == null || removedVisibleIdx < 0) return lb;
          if (visibleAfter.length === 0) return null;
          if (lb > removedVisibleIdx) return lb - 1;
          if (lb === removedVisibleIdx) return Math.min(lb, visibleAfter.length - 1);
          return lb;
        });
        return next;
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleDownloadOne = async (img: UnitTestImageRow) => {
    setDownloadingKey(img.s3Key);
    try {
      await downloadUnitTestImage(workType, img.s3Key, img.fileName);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDownloadAll = () => {
    if (imageCount === 0) return;
    setDownloadingZip(true);
    try {
      downloadUnitTestImagesZip(workType);
      window.setTimeout(() => setDownloadingZip(false), 3000);
    } catch (e) {
      setDownloadingZip(false);
      window.alert(e instanceof Error ? e.message : 'ZIP download failed');
    }
  };

  const openLightbox = (index: number) => {
    if (!images[index]?.url) return;
    setLightboxIndex(index);
  };

  const imageCount = images.length;
  const visibleCount = visibleImages.length;
  const filtersActive = unitTestImageFiltersActive(filters);

  const imageCountLabel = (() => {
    if (loading || err) return null;
    if (filtersActive && imageCount > 0) {
      return `${visibleCount.toLocaleString()} of ${imageCount.toLocaleString()} ${
        imageCount === 1 ? 'image' : 'images'
      }`;
    }
    return `${imageCount.toLocaleString()} ${imageCount === 1 ? 'image' : 'images'}`;
  })();

  const clearFilters = () => setFilters({ query: '', difficulty: 'all' });

  return (
    <div className="readings-list-page unit-test-images-page">
      <header className="page-header unit-test-images-page-header">
        <div className="header-content list-page-header-with-actions">
          <div className="list-page-header-lead">
            <div className="page-title">
              <ImageIcon size={32} strokeWidth={1.5} />
              <div>
                <h1>Unit test images</h1>
                {!loading && !err && imageCountLabel ? (
                  <p aria-live="polite">{imageCountLabel}</p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="unit-test-images-header-actions">
            <button
              type="button"
              className="refresh-button unit-test-images-download-all-btn"
              disabled={loading || downloadingZip || imageCount === 0}
              onClick={() => handleDownloadAll()}
              aria-busy={downloadingZip}
              title={
                downloadingZip
                  ? 'Building ZIP on server (may take up to a minute)…'
                  : 'Download all images as a ZIP'
              }
              aria-label={
                downloadingZip ? 'Building ZIP download' : 'Download all images as a ZIP'
              }
            >
              {downloadingZip ? (
                <Loader2 size={17} className="spin" aria-hidden />
              ) : (
                <Download size={17} aria-hidden />
              )}
            </button>
            <ListPageRefreshButton
              variant="icon"
              onRefresh={() => void handleRefresh()}
              busy={refreshing || loading}
              disabled={loading}
              title="Refresh unit test images"
            />
          </div>
        </div>

        {!loading && !err && imageCount > 0 ? (
          <div className="unit-test-images-filter-toolbar">
            <label className="unit-test-images-search-field">
              <Search size={18} className="unit-test-images-search-icon" aria-hidden />
              <input
                type="search"
                placeholder="Search by file name or reading…"
                value={filters.query}
                onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
                aria-label="Search unit test images by file name or ground-truth reading"
              />
              {filters.query ? (
                <button
                  type="button"
                  className="unit-test-images-search-clear"
                  onClick={() => setFilters((prev) => ({ ...prev, query: '' }))}
                  aria-label="Clear search"
                >
                  <X size={16} aria-hidden />
                </button>
              ) : null}
            </label>
            <label className="unit-test-images-filter-select-wrap">
              <span className="unit-test-images-filter-label">Difficulty</span>
              <select
                className="unit-test-images-filter-select"
                value={filters.difficulty}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    difficulty: e.target.value as UnitTestImageDifficultyFilter,
                  }))
                }
                aria-label="Filter by image difficulty"
              >
                {UNIT_TEST_DIFFICULTY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {filtersActive ? (
              <>
                <p className="unit-test-images-search-meta" aria-live="polite">
                  Showing <strong>{visibleCount.toLocaleString()}</strong> of{' '}
                  {imageCount.toLocaleString()} images
                </p>
                <button type="button" className="unit-test-images-filter-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {loading && images.length === 0 ? <ListViewLoading message="Loading unit test images…" /> : null}
      {loading && images.length > 0 ? (
        <ListViewLoading variant="inline" message="Refreshing images…" />
      ) : null}
      {err ? <p className="unit-test-images-page-message training-hub-inline-error">{err}</p> : null}

      {!loading && !err && images.length === 0 ? (
        <p className="unit-test-images-page-message pipeline-iterations-empty">
          No unit test images in this prefix yet.
        </p>
      ) : null}

      {!loading && !err && imageCount > 0 && visibleCount === 0 ? (
        <p className="unit-test-images-page-message pipeline-iterations-empty">
          No images match the current filters.
          {filters.query.trim() ? (
            <>
              {' '}
              Search: &ldquo;{filters.query.trim()}&rdquo;.
            </>
          ) : null}
          {filters.difficulty !== 'all' ? (
            <>
              {' '}
              Difficulty:{' '}
              {UNIT_TEST_DIFFICULTY_FILTER_OPTIONS.find((o) => o.id === filters.difficulty)?.label}.
            </>
          ) : null}
        </p>
      ) : null}

      {!loading && visibleCount > 0 ? (
        <div className="unit-test-images-grid unit-test-images-page-grid">
          {visibleImages.map((img, index) => {
            const busy = deletingKey === img.s3Key;
            const downloading = downloadingKey === img.s3Key;
            const difficulty = img.imageDifficulty || 'normal';
            return (
              <article key={img.s3Key} className="unit-test-images-card">
                {img.url ? (
                  <button
                    type="button"
                    className="unit-test-images-thumb-btn"
                    onClick={() => openLightbox(index)}
                    aria-label={`Open ${img.fileName}`}
                  >
                    <img src={img.url} alt="" className="unit-test-images-thumb" loading="lazy" />
                  </button>
                ) : (
                  <div className="unit-test-images-thumb unit-test-images-thumb--empty">No preview</div>
                )}
                <div className="unit-test-images-card-head">
                  <span className={difficultyBadgeClass(difficulty)}>
                    {formatUnitTestDifficultyTag(difficulty)}
                  </span>
                </div>
                <p className="unit-test-images-name">
                  <code>{img.fileName}</code>
                </p>
                <p className="unit-test-images-expected">
                  Ground truth: <strong>{img.expectedMeterValue ?? '—'}</strong>
                </p>
                <div className="unit-test-images-card-actions">
                  <button
                    type="button"
                    className="unit-test-images-download-btn unit-test-images-icon-btn"
                    disabled={busy || downloading}
                    onClick={() => void handleDownloadOne(img)}
                    title={`Download ${img.fileName}`}
                    aria-label={`Download ${img.fileName}`}
                  >
                    {downloading ? (
                      <Loader2 size={16} className="spin" aria-hidden />
                    ) : (
                      <ArrowDown size={16} aria-hidden />
                    )}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className="unit-test-images-delete-btn"
                      disabled={busy}
                      onClick={() => void handleDelete(img)}
                    >
                      {busy ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} aria-hidden />}
                      Delete
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {lightboxIndex != null && visibleImages[lightboxIndex]?.url ? (
        <UnitTestImageLightbox
          workType={workType}
          images={visibleImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onImageUpdated={handleImageUpdated}
          readOnly={!canEdit}
          portalWorkMode={outletCtx?.workMode ?? 'test_data_reviewer'}
        />
      ) : null}
    </div>
  );
};

export default UnitTestImagesPage;
