import type { DashboardCounts, ReadingStatus } from '../types';

const STATUS_COUNT_KEY: Partial<Record<ReadingStatus, keyof DashboardCounts>> = {
  correct: 'correctCount',
  incorrect_new: 'incorrectNewCount',
  incorrect_analyzed: 'incorrectAnalyzedCount',
  incorrect_labeled: 'incorrectLabeledCount',
  incorrect_training: 'incorrectTrainingCount',
  no_dials: 'noDialsCount',
  not_sure: 'notSureCount',
  manually_uploaded: 'manuallyUploadedCount',
};

/** Shift dashboard folder counts when a session moves between status queues (optimistic UI). */
export function adjustDashboardCountsForStatusMove(
  counts: DashboardCounts,
  fromStatus: ReadingStatus,
  toStatus: ReadingStatus,
): DashboardCounts {
  if (fromStatus === toStatus) return counts;
  const next = { ...counts };
  const decKey = STATUS_COUNT_KEY[fromStatus];
  const incKey = STATUS_COUNT_KEY[toStatus];
  if (decKey) {
    const v = next[decKey];
    if (typeof v === 'number' && v > 0) {
      (next as Record<string, number>)[decKey] = v - 1;
    }
  }
  if (incKey) {
    const v = next[incKey];
    (next as Record<string, number>)[incKey] = (typeof v === 'number' ? v : 0) + 1;
  }
  return next;
}
