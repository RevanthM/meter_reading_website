import type { ReviewAssignmentBatchSummary, S3MeterReading } from '../services/api';

export function normalizeAssigneeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

export function isAssignedToUser(
  reading: Pick<S3MeterReading, 'reviewAssignedTo'>,
  userEmail: string | null | undefined,
): boolean {
  const mine = normalizeAssigneeEmail(userEmail);
  if (!mine) return false;
  return normalizeAssigneeEmail(reading.reviewAssignedTo) === mine;
}

export function filterAssignedToUser<T extends Pick<S3MeterReading, 'reviewAssignedTo'>>(
  readings: T[],
  userEmail: string | null | undefined,
): T[] {
  return readings.filter((r) => isAssignedToUser(r, userEmail));
}

/** Stable queue order from open assignment batches (batch order, then slice order). */
export function mergeAssignmentSessionOrder(batches: ReviewAssignmentBatchSummary[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const open = batches.filter((b) => b && b.status === 'open');
  for (const batch of open) {
    const list = batch.mySessionIds?.length
      ? batch.mySessionIds
      : [];
    for (const id of list) {
      const sid = String(id);
      if (seen.has(sid)) continue;
      seen.add(sid);
      ids.push(sid);
    }
  }
  return ids;
}

export function sortReadingsByAssignmentOrder<T extends { id: string }>(
  readings: T[],
  orderIds: string[],
): T[] {
  if (orderIds.length === 0) return readings;
  const rank = new Map(orderIds.map((id, i) => [String(id), i]));
  return [...readings].sort((a, b) => {
    const ra = rank.get(String(a.id));
    const rb = rank.get(String(b.id));
    if (ra == null && rb == null) return String(a.id).localeCompare(String(b.id));
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  });
}

export function assignmentAssignParamActive(searchParams: URLSearchParams): boolean {
  return searchParams.get('assign') === 'me';
}
