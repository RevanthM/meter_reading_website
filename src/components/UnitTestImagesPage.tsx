import { useCallback, useEffect, useState, type FC } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ImageIcon, Loader2, Pencil, Trash2 } from 'lucide-react';
import { deleteUnitTestImage, fetchUnitTestImages, type UnitTestImageRow } from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import { formatUnitTestDifficultyTag } from '../utils/unitTestImageNaming';
import type { UnitTestImageEditLocationState } from './UnitTestImageEditPage';

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
  const [manifestKey, setManifestKey] = useState('');
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchUnitTestImages(workType);
      setImages(data.images);
      setManifestKey(data.manifestKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [workType]);

  useEffect(() => {
    if (outletCtx?.workMode !== 'test_data_reviewer') {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const openEdit = (img: UnitTestImageRow) => {
    const state: UnitTestImageEditLocationState = {
      imageQueueS3Keys: images.map((i) => i.s3Key),
      listReturn: { pathname: '/test-data/images' },
    };
    navigate(`/test-data/images/edit/${encodeURIComponent(img.fileName)}`, { state });
  };

  const handleDelete = async (img: UnitTestImageRow) => {
    if (
      !window.confirm(
        `Delete ${img.fileName} from unit test images?\n\nThis removes the file from S3 and the manifest. Session folders are not deleted.`,
      )
    ) {
      return;
    }
    setDeletingKey(img.s3Key);
    try {
      await deleteUnitTestImage(workType, img.s3Key);
      setImages((prev) => prev.filter((row) => row.s3Key !== img.s3Key));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="readings-list-page">
      <header className="page-header">
        <div className="page-title">
          <ImageIcon size={32} strokeWidth={1.5} />
          <div>
            <h1>Unit test images</h1>
            <p>
              Flat files under <code>{workType}/unit_test_images/</code>
              {manifestKey ? (
                <>
                  {' '}
                  · manifest <code>{manifestKey.split('/').pop()}</code>
                </>
              ) : null}
            </p>
            <p className="reading-detail-field-hint">
              Naming: <code>{'{index}_d{1|2|3}_{reading}.ext'}</code> (d1 normal · d2 difficult · d3 very difficult)
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <p className="training-pipeline-bar-hint">
          <Loader2 size={18} className="spin" /> Loading…
        </p>
      ) : null}
      {err ? <p className="training-hub-inline-error">{err}</p> : null}

      {!loading && !err && images.length === 0 ? (
        <p className="pipeline-iterations-empty">No unit test images in this prefix yet.</p>
      ) : null}

      <div className="unit-test-images-grid">
        {images.map((img) => {
          const busy = deletingKey === img.s3Key;
          const difficulty = img.imageDifficulty || 'normal';
          return (
            <article key={img.s3Key} className="unit-test-images-card">
              {img.url ? (
                <img src={img.url} alt={img.fileName} className="unit-test-images-thumb" loading="lazy" />
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
                Expected: <strong>{img.expectedMeterValue ?? '—'}</strong>
              </p>
              <div className="unit-test-images-card-actions">
                <button
                  type="button"
                  className="unit-test-images-edit-btn"
                  disabled={busy}
                  onClick={() => openEdit(img)}
                >
                  <Pencil size={16} aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  className="unit-test-images-delete-btn"
                  disabled={busy}
                  onClick={() => void handleDelete(img)}
                >
                  {busy ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} aria-hidden />}
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default UnitTestImagesPage;
