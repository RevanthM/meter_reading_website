import type { S3MeterReading } from '../services/api';
import { fieldTestGroundTruthReading, fieldTestPredictedReading } from './fieldTestDisplay';

function pad4(value: string | number | null | undefined): string {
  const raw = String(value ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

/** Count dial positions where ground truth digit ≠ on-device model digit. */
export function countFieldTestDialReadingChanges(
  groundTruth: string | null | undefined,
  modelReading: string | null | undefined,
): number {
  const gt = pad4(groundTruth);
  const model = pad4(modelReading);
  if (!gt || !model) return 0;
  let changed = 0;
  for (let i = 0; i < 4; i++) {
    if (gt[i] !== model[i]) changed += 1;
  }
  return changed;
}

export type FieldTestCorrectionMeta = {
  /** At least one dial digit differs from model, or device flagged dial edits. */
  isCorrected: boolean;
  /** How many dial positions differ (ground truth vs model). */
  dialsChangedCount: number;
  /** Portal reviewer email when a portal save followed a real dial change. */
  correctedBy: string | null;
  /** ISO timestamp (`portal_metadata_updated_at`) for that save. */
  correctedAt: string | null;
  /** iOS/user changed dials on device; no portal reviewer on record. */
  correctedOnDevice: boolean;
};

export function fieldTestReviewerCorrectionMeta(
  reading: Pick<
    S3MeterReading,
    | 'hadUserCorrection'
    | 'portalMetadataUpdatedBy'
    | 'portalMetadataUpdatedAt'
    | 'expectedValue'
    | 'rawPrediction'
    | 'meterValue'
    | 'feedbackType'
    | 'isCorrect'
    | 'finalReading'
  >,
): FieldTestCorrectionMeta {
  const correctedBy = String(reading.portalMetadataUpdatedBy ?? '').trim() || null;
  const correctedAt = String(reading.portalMetadataUpdatedAt ?? '').trim() || null;
  const groundTruth = fieldTestGroundTruthReading(reading);
  const modelReading = fieldTestPredictedReading(reading);
  const dialsChangedCount = countFieldTestDialReadingChanges(groundTruth, modelReading);
  const deviceCorrected = reading.hadUserCorrection === true;
  const isCorrected = deviceCorrected || dialsChangedCount > 0;
  const portalAttributed = Boolean(isCorrected && correctedBy);

  return {
    isCorrected,
    dialsChangedCount,
    correctedBy: portalAttributed ? correctedBy : null,
    correctedAt: portalAttributed && correctedAt ? correctedAt : null,
    correctedOnDevice: isCorrected && deviceCorrected && !portalAttributed,
  };
}
