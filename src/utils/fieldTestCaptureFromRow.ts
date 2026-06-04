import type { FieldTestCaptureRow } from '../services/api';
import { fieldTestReviewerCorrectionMeta } from './fieldTestCorrectionMeta';
import { perImageRowSessionId } from './unitTestCsvAnalytics';

/** Build a field-test capture card from analytics / confusion `perImageRows` CSV fields. */
export function fieldTestCaptureFromPerImageRow(
  row: Record<string, string>,
): FieldTestCaptureRow | null {
  const sessionId = perImageRowSessionId(row);
  const primaryImageKey = (row.s3_key || '').trim();
  if (!sessionId || !primaryImageKey) return null;

  const parts = primaryImageKey.split('/');
  const s3SessionPrefix = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
  const finalReading = (row.expected_reading_from_filename || row.final_reading || '').trim() || null;
  const predictedReading = (row.predicted_reading || row.ml_raw_prediction || '').trim() || null;
  const difficulty = (row.image_difficulty || 'normal') as FieldTestCaptureRow['imageDifficulty'];
  const readsCorrected = parseInt(row.reads_corrected_count || '0', 10) || 0;
  const dialCount = parseInt(row.dial_count || '4', 10) || 4;
  const confidenceRaw = parseFloat(row.average_confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? confidenceRaw <= 1 && confidenceRaw >= 0
      ? confidenceRaw * 100
      : confidenceRaw
    : null;

  const isCorrectRaw = (row.is_correct || '').trim().toLowerCase();
  const correction = fieldTestReviewerCorrectionMeta({
    hadUserCorrection:
      row.had_user_correction === 'true' ||
      readsCorrected > 0 ||
      row.is_corrected === 'true',
    portalMetadataUpdatedBy: row.corrected_by || row.portal_metadata_updated_by,
    portalMetadataUpdatedAt: row.corrected_at || row.portal_metadata_updated_at,
    expectedValue: row.user_correction || row.expected_reading_from_filename,
    rawPrediction: row.ml_raw_prediction || row.predicted_reading,
    meterValue: row.ml_prediction,
    feedbackType: row.feedback_type,
    isCorrect:
      isCorrectRaw === 'true' ? true : isCorrectRaw === 'false' ? false : undefined,
    finalReading: row.final_reading || row.expected_reading_from_filename,
  });

  const isCorrected =
    row.is_corrected === 'true' || row.is_corrected === 'false'
      ? row.is_corrected === 'true'
      : correction.isCorrected;
  const correctedBy =
    (row.corrected_by || '').trim() || correction.correctedBy;
  const correctedAt =
    (row.corrected_at || '').trim() || correction.correctedAt;
  const correctedOnDevice =
    row.corrected_on_device === 'true' || row.corrected_on_device === 'false'
      ? row.corrected_on_device === 'true'
      : correction.correctedOnDevice;

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
    hadUserCorrection: isCorrected,
    correctedBy: isCorrected && correctedBy ? correctedBy : null,
    correctedAt: isCorrected && correctedAt ? correctedAt : null,
    correctedOnDevice: isCorrected && correctedOnDevice,
    dialCount,
    confidence,
    appVersion: row.app_version?.trim() || null,
  };
}
