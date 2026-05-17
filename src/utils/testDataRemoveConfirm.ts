import type { S3MeterReading } from '../services/api';

/** User-facing confirm for remove-from-test-dataset (queue vs S3+manifest). */
export function confirmRemoveFromTestDataset(reading: Pick<
  S3MeterReading,
  'testDataReviewStatus' | 'testDataUnitTestS3Key' | 'testDataUnitTestFileName'
>): boolean {
  const inUnitTestLibrary =
    reading.testDataReviewStatus === 'approved' || Boolean(reading.testDataUnitTestS3Key?.trim());

  if (inUnitTestLibrary) {
    const fileLabel = reading.testDataUnitTestFileName?.trim() || 'the unit test image';
    return window.confirm(
      `Remove from test dataset?\n\n` +
        `• Clears this session from the test queue\n` +
        `• Deletes ${fileLabel} from unit_test_images/ and updates the manifest`,
    );
  }

  return window.confirm(
    'Remove from test dataset queue?\n\n' +
      'This only removes the session from your pending list. Nothing is deleted from S3 until it has been approved into unit test images.',
  );
}
