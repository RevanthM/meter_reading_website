/** Portal-only second review pass for field test captures (no iOS changes). */

export const PORTAL_MANUAL_REVIEW_STATUSES = ['pending', 'correct', 'incorrect'];

export function normalizePortalManualReviewStatus(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'correct' || v === 'incorrect') return v;
  return 'pending';
}

export function matchesPortalManualReviewFilter(reading, filter) {
  const f = String(filter || 'all').trim().toLowerCase();
  if (!f || f === 'all') return true;
  const status = normalizePortalManualReviewStatus(
    reading?.portal_manual_review_status ?? reading?.portalManualReviewStatus,
  );
  return status === f;
}

export function portalManualReviewFromMetadata(metadata) {
  const status = normalizePortalManualReviewStatus(metadata?.portal_manual_review_status);
  return {
    portal_manual_review_status: status === 'pending' ? null : status,
    portal_manual_reviewed_by:
      typeof metadata?.portal_manual_reviewed_by === 'string' && metadata.portal_manual_reviewed_by.trim()
        ? metadata.portal_manual_reviewed_by.trim().slice(0, 320)
        : null,
    portal_manual_reviewed_at:
      typeof metadata?.portal_manual_reviewed_at === 'string' ? metadata.portal_manual_reviewed_at : null,
    portal_manual_review_notes:
      metadata?.portal_manual_review_notes != null
        ? String(metadata.portal_manual_review_notes).slice(0, 8000)
        : null,
  };
}

/**
 * Field-test Results stats: portal manual review overrides field-test reviewer verdict when set.
 * Images tab cohorts still use field-test review only.
 */
export function fieldTestStatsCaptureCorrect(item) {
  const portal = normalizePortalManualReviewStatus(
    item?.portal_manual_review_status ?? item?.portalManualReviewStatus,
  );
  if (portal === 'correct') return true;
  if (portal === 'incorrect') return false;

  const status = String(item?.folder_status ?? '').trim().toLowerCase();
  if (status === 'correct') return true;
  const feedback = String(item?.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'correct') return true;
  return item?.is_correct === true;
}

/** Inverse of {@link fieldTestStatsCaptureCorrect} for scorable captures. */
export function fieldTestStatsCaptureIncorrect(item) {
  const portal = normalizePortalManualReviewStatus(
    item?.portal_manual_review_status ?? item?.portalManualReviewStatus,
  );
  if (portal === 'correct') return false;
  if (portal === 'incorrect') return true;

  const feedback = String(item?.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'incorrect') return true;
  const status = String(item?.folder_status ?? '').trim().toLowerCase();
  return (
    status === 'incorrect_analyzed' ||
    status === 'incorrect_labeled' ||
    status === 'incorrect_training' ||
    (status === 'incorrect_new' && item?.is_manually_reviewed === true)
  );
}
