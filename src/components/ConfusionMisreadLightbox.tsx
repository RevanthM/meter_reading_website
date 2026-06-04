import { useCallback, useEffect, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FieldTestCaptureRow, UnitTestImageRow } from '../services/api';
import { presignFieldTestCaptureUrls } from '../services/api';
import type { WorkType } from '../types';
import { fieldTestCaptureFromPerImageRow } from '../utils/fieldTestCaptureFromRow';
import { resolveUnitTestImagesFromRows } from '../utils/resolveUnitTestImages';
import UnitTestImageLightbox from './UnitTestImageLightbox';
import FieldTestCaptureLightbox from './FieldTestCaptureLightbox';

export type ConfusionImageSource = 'unit_test' | 'field_test';

type Props = {
  workType: WorkType;
  source: ConfusionImageSource;
  rows: Record<string, string>[];
  expectedDigit: number;
  predictedDigit: number;
  dial: number | 'all';
  onClose: () => void;
};

const ConfusionMisreadLightbox: FC<Props> = ({
  workType,
  source,
  rows,
  expectedDigit,
  predictedDigit,
  dial,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [imageRemovedFromLibrary, setImageRemovedFromLibrary] = useState(false);
  const [unitImages, setUnitImages] = useState<UnitTestImageRow[]>([]);
  const [fieldCaptures, setFieldCaptures] = useState<FieldTestCaptureRow[]>([]);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setImageRemovedFromLibrary(false);
    setIndex(0);
    try {
      if (source === 'unit_test') {
        const { images, missing } = await resolveUnitTestImagesFromRows(rows, workType);
        if (!images.length) {
          if (missing.length > 0) {
            setImageRemovedFromLibrary(true);
          } else {
            setErr('Could not load images for this cell.');
          }
        }
        setUnitImages(images);
        setFieldCaptures([]);
      } else {
        const captures = rows
          .map((row) => fieldTestCaptureFromPerImageRow(row))
          .filter((cap): cap is FieldTestCaptureRow => cap != null);
        if (!captures.length) {
          setErr('Could not resolve field test captures for this cell.');
          setFieldCaptures([]);
          return;
        }
        const urls = await presignFieldTestCaptureUrls(captures);
        const withUrls = captures.map((cap) => ({ ...cap, url: urls[cap.sessionId] }));
        if (!withUrls.some((c) => c.url)) {
          setErr('Could not presign field test images for this cell.');
        }
        setFieldCaptures(withUrls);
        setUnitImages([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load images');
      setUnitImages([]);
      setFieldCaptures([]);
    } finally {
      setLoading(false);
    }
  }, [rows, source, workType]);

  useEffect(() => {
    void load();
  }, [load]);

  const dialLabel = dial === 'all' ? 'any dial' : `dial ${dial}`;
  const title = `True ${expectedDigit} → predicted ${predictedDigit} (${dialLabel})`;

  if (loading) {
    return (
      <div className="confusion-misread-lightbox-loading" role="dialog" aria-modal aria-label={title}>
        <div className="chart-empty chart-empty--tight">
          <Loader2 size={28} className="spin" />
          <span>Loading {rows.length} image{rows.length === 1 ? '' : 's'}…</span>
        </div>
        <button type="button" className="confusion-misread-lightbox-dismiss" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (err || imageRemovedFromLibrary || (source === 'unit_test' ? unitImages.length === 0 : fieldCaptures.length === 0)) {
    return (
      <div className="confusion-misread-lightbox-loading" role="dialog" aria-modal aria-label={title}>
        {imageRemovedFromLibrary ? (
          <div className="confusion-misread-error-panel">
            <p className="confusion-misread-error-panel-title">Image removed from unit test library.</p>
            <p className="confusion-misread-error-panel-links">
              <Link to="/unit-test/results" onClick={onClose}>
                Unit test results
              </Link>
              <span aria-hidden> · </span>
              <Link to="/test-data/images" onClick={onClose}>
                Unit test images
              </Link>
            </p>
          </div>
        ) : (
          <p className="confusion-misread-error-panel confusion-misread-error-panel--plain">
            {err || 'No images for this cell.'}
          </p>
        )}
        <button type="button" className="confusion-misread-lightbox-dismiss" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (source === 'unit_test') {
    return (
      <UnitTestImageLightbox
        workType={workType}
        images={unitImages}
        index={index}
        onClose={onClose}
        onIndexChange={setIndex}
        onImageUpdated={() => {}}
        readOnly
        portalWorkMode="admin"
        misreadLabel={title}
      />
    );
  }

  return (
    <FieldTestCaptureLightbox
      captures={fieldCaptures}
      index={index}
      workType={workType}
      misreadLabel={title}
      onClose={onClose}
      onIndexChange={setIndex}
    />
  );
};

export default ConfusionMisreadLightbox;
