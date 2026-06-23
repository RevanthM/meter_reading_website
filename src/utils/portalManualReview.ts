import type { S3MeterReading } from '../services/api';

export type PortalManualReviewStatus = 'pending' | 'correct' | 'incorrect';

export const PORTAL_MANUAL_REVIEW_FILTER_IDS = ['pending', 'correct', 'incorrect'] as const;
export type PortalManualReviewFilterId = (typeof PORTAL_MANUAL_REVIEW_FILTER_IDS)[number];

export const PORTAL_MANUAL_REVIEW_LABELS: Record<PortalManualReviewStatus, string> = {
  pending: 'Awaiting portal review',
  correct: 'Portal correct',
  incorrect: 'Portal incorrect',
};

/** Shorter labels for dense list tables (use `title` for full text). */
export const PORTAL_MANUAL_REVIEW_LIST_LABELS: Record<PortalManualReviewStatus, string> = {
  pending: 'Awaiting',
  correct: 'Correct',
  incorrect: 'Incorrect',
};

export function normalizePortalManualReviewStatus(
  value: string | null | undefined,
): PortalManualReviewStatus {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'correct' || v === 'incorrect') return v;
  return 'pending';
}

export function isPortalManualReviewFilterId(s: string): s is PortalManualReviewFilterId {
  return (PORTAL_MANUAL_REVIEW_FILTER_IDS as readonly string[]).includes(s);
}

export function matchesPortalManualReviewFilter(
  reading: Pick<S3MeterReading, 'portalManualReviewStatus'>,
  filter: PortalManualReviewFilterId | null,
): boolean {
  if (!filter) return true;
  return normalizePortalManualReviewStatus(reading.portalManualReviewStatus) === filter;
}

export function portalManualReviewBadge(status: PortalManualReviewStatus): {
  label: string;
  color: string;
} {
  switch (status) {
    case 'correct':
      return { label: PORTAL_MANUAL_REVIEW_LABELS.correct, color: '#16a34a' };
    case 'incorrect':
      return { label: PORTAL_MANUAL_REVIEW_LABELS.incorrect, color: '#dc2626' };
    default:
      return { label: PORTAL_MANUAL_REVIEW_LABELS.pending, color: '#64748b' };
  }
}

export function portalManualReviewListBadge(status: PortalManualReviewStatus): {
  label: string;
  fullLabel: string;
  color: string;
} {
  const full = portalManualReviewBadge(status);
  return {
    label: PORTAL_MANUAL_REVIEW_LIST_LABELS[status],
    fullLabel: full.label,
    color: full.color,
  };
}

export function isFieldTestPortalReading(
  reading: Pick<S3MeterReading, 'fieldTestCapture' | 'uploadMode' | 'type'>,
): boolean {
  if (reading.fieldTestCapture === true) return true;
  if (String(reading.uploadMode || '').toLowerCase() !== 'field') return false;
  return String(reading.type || '').toLowerCase() === 'field';
}
