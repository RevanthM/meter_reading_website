import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useReadings } from '../context/ReadingsContext';
import type { S3MeterReading } from '../services/api';

export function mergeFieldTestReadingsWithContext(
  readings: S3MeterReading[],
  getReadingById: (id: string) => S3MeterReading | undefined,
): S3MeterReading[] {
  return readings.map((r) => {
    const fromCtx = getReadingById(r.id);
    return fromCtx ? { ...r, ...fromCtx } : r;
  });
}

/**
 * Field test list/images pages keep their own capture list from fetchFieldTestCaptures.
 * ReadingDetail saves via ReadingsContext.upsertReading — merge those updates into local state
 * so the list reflects corrections immediately without waiting for S3 sync or manual refresh.
 */
export function useMergeContextReadingUpserts(
  setLocalReadings: Dispatch<SetStateAction<S3MeterReading[]>>,
): { mergeWithContext: (readings: S3MeterReading[]) => S3MeterReading[] } {
  const { readingUpsertRevision, getReadingById } = useReadings();

  const mergeWithContext = useCallback(
    (readings: S3MeterReading[]) => mergeFieldTestReadingsWithContext(readings, getReadingById),
    [getReadingById],
  );

  useEffect(() => {
    if (readingUpsertRevision === 0) return;
    setLocalReadings((prev) => mergeFieldTestReadingsWithContext(prev, getReadingById));
  }, [readingUpsertRevision, getReadingById, setLocalReadings]);

  return { mergeWithContext };
}
