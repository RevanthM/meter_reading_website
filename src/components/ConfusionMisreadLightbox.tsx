import { useCallback, useEffect, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { FieldTestCaptureRow, UnitTestImageRow } from '../services/api';
import {
  presignFieldTestCaptureUrls,
  presignUnitTestImages,
} from '../services/api';
import type { WorkType } from '../types';
import {
  perImageRowFileName,
  perImageRowSessionId,
} from '../utils/unitTestCsvAnalytics';
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

function fieldTestCaptureFromRow(row: Record<string, string>): FieldTestCaptureRow | null {
  const sessionId = perImageRowSessionId(row);
  const primaryImageKey = (row.s3_key || '').trim();
  if (!sessionId || !primaryImageKey) return null;
  const parts = primaryImageKey.split('/');
  const s3SessionPrefix = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
  const finalReading = (row.expected_reading_from_filename || '').trim() || null;
  const predictedReading = (row.predicted_reading || '').trim() || null;
  const difficulty = (row.image_difficulty || 'normal') as FieldTestCaptureRow['imageDifficulty'];
  const readsCorrected = parseInt(row.reads_corrected_count || '0', 10) || 0;
  const dialCount = parseInt(row.dial_count || '4', 10) || 4;
  const confidenceRaw = parseFloat(row.average_confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? confidenceRaw <= 1 && confidenceRaw >= 0
      ? confidenceRaw * 100
      : confidenceRaw
    : null;
  return {
    sessionId,
    s3SessionPrefix,
    primaryImageKey,
    capturedAt: row.captured_at || '',
    capturedBy: row.captured_by || '',
    finalReading,
    predictedReading,
    imageDifficulty: difficulty,
    onTickDialCount: null,
    readsCorrectedCount: readsCorrected,
    hadUserCorrection: readsCorrected > 0,
    dialCount,
    confidence,
    appVersion: null,
  };
}

function unitTestImageFromRow(row: Record<string, string>, url?: string): UnitTestImageRow | null {
  const s3Key = (row.s3_key || '').trim();
  const fileName = perImageRowFileName(row);
  if (!s3Key || !fileName) return null;
  return {
    s3Key,
    fileName,
    expectedMeterValue: (row.expected_reading_from_filename || '').trim() || null,
    imageDifficulty: (row.image_difficulty as UnitTestImageRow['imageDifficulty']) || 'normal',
    url,
  };
}

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
  const [unitImages, setUnitImages] = useState<UnitTestImageRow[]>([]);
  const [fieldCaptures, setFieldCaptures] = useState<FieldTestCaptureRow[]>([]);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setIndex(0);
    try {
      if (source === 'unit_test') {
        const keys = rows.map((r) => (r.s3_key || '').trim()).filter(Boolean);
        const urls = keys.length ? await presignUnitTestImages(keys) : {};
        const images = rows
          .map((row) => unitTestImageFromRow(row, urls[(row.s3_key || '').trim()]))
          .filter((img): img is UnitTestImageRow => img != null && Boolean(img.url));
        if (!images.length) {
          setErr('Could not load unit test images for this cell.');
        }
        setUnitImages(images);
        setFieldCaptures([]);
      } else {
        const captures = rows
          .map((row) => fieldTestCaptureFromRow(row))
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
  }, [rows, source]);

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

  if (err || (source === 'unit_test' ? unitImages.length === 0 : fieldCaptures.length === 0)) {
    return (
      <div className="confusion-misread-lightbox-loading" role="dialog" aria-modal aria-label={title}>
        <p className="pipeline-iterations-chart-card-placeholder">{err || 'No images for this cell.'}</p>
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
      />
    );
  }

  return (
    <FieldTestCaptureLightbox
      captures={fieldCaptures}
      index={index}
      workType={workType}
      onClose={onClose}
      onIndexChange={setIndex}
    />
  );
};

export default ConfusionMisreadLightbox;
