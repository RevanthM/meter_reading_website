import type { S3MeterReading } from '../services/api';

function pad4(value: string | number | null | undefined): string {
  const raw = String(value ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

function pickGroundTruth(candidates: (string | null | undefined)[]): string {
  const picked = candidates.find((v) => v != null && String(v).trim() !== '');
  return pad4(picked ?? '');
}

/** Same rules as server `finalReadingFromMetadata` (reviewer truth for field test). */
export function fieldTestGroundTruthReading(
  reading: Pick<
    S3MeterReading,
    'expectedValue' | 'meterValue' | 'rawPrediction' | 'feedbackType' | 'isCorrect' | 'finalReading'
  > & { finalReading?: string | null },
): string | null {
  const feedback = String(reading.feedbackType ?? '').trim().toLowerCase();
  const reviewerWrong = reading.isCorrect === false || feedback === 'incorrect';
  const reviewerRight = reading.isCorrect === true || feedback === 'correct';

  if (reviewerWrong) {
    const s = pickGroundTruth([
      reading.expectedValue,
      reading.finalReading,
      reading.rawPrediction,
      reading.meterValue,
    ]);
    return s || null;
  }
  if (reviewerRight) {
    const s = pickGroundTruth([
      reading.finalReading,
      reading.rawPrediction,
      reading.expectedValue,
      reading.meterValue,
    ]);
    return s || null;
  }
  const s = pickGroundTruth([
    reading.finalReading,
    reading.rawPrediction,
    reading.expectedValue,
    reading.meterValue,
  ]);
  return s || null;
}

/** On-device model read before review (`ml_raw_prediction`). */
export function fieldTestPredictedReading(
  reading: Pick<S3MeterReading, 'rawPrediction' | 'meterValue'>,
): string | null {
  const s = pad4(reading.rawPrediction ?? reading.meterValue ?? '');
  return s || null;
}

export function fieldTestCaptureFromReading(r: S3MeterReading) {
  const finalReading = fieldTestGroundTruthReading(r);
  const predictedReading = fieldTestPredictedReading(r);
  return { finalReading, predictedReading };
}
