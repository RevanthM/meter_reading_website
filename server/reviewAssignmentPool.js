import { calendarDayKeyInPortalTz } from './improvementAnalytics.js';
import { sessionItemToReading } from './sessionIndex/metadataMapping.js';
import { isFieldTestPortalCapture } from './fieldTestDerive.js';

export const REVIEW_ASSIGNMENT_POOLS = ['field_test', 'awaiting_review'];

function isValidReading(reading) {
  return reading != null && typeof reading === 'object' && Boolean(reading.id);
}

function isAwaitingReviewerReview(reading) {
  if (!isValidReading(reading)) return false;
  return reading.status === 'incorrect_new' && reading.isManuallyReviewed !== true;
}

function isFieldTestReading(reading) {
  if (!reading) return false;
  return isFieldTestPortalCapture({
    field_test_capture: reading.fieldTestCapture === true,
    upload_mode: reading.uploadMode,
    source_type: reading.type,
    feedback_type: reading.feedbackType,
    folder_status: reading.status,
  });
}

function readingDayKey(reading) {
  return (
    calendarDayKeyInPortalTz(reading.dateOfReading || '') ||
    calendarDayKeyInPortalTz(reading.createdAt || '') ||
    ''
  );
}

function matchesDateRange(reading, dateFrom, dateTo) {
  if (!isValidReading(reading)) return false;
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  if (!from && !to) return true;
  const day = readingDayKey(reading);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function matchesCohort(reading, cohort) {
  if (!isValidReading(reading)) return false;
  const c = String(cohort || 'untrained').trim().toLowerCase();
  if (c === 'all') return true;
  if (c === 'untrained') return isAwaitingReviewerReview(reading);
  if (c === 'correct') return reading.status === 'correct';
  if (c === 'incorrect') {
    return (
      reading.status === 'incorrect_analyzed' ||
      reading.status === 'incorrect_labeled' ||
      reading.status === 'incorrect_training' ||
      (reading.status === 'incorrect_new' && reading.isManuallyReviewed === true)
    );
  }
  if (c === 'training') {
    return (
      reading.status !== 'incorrect_training' &&
      (reading.reviewerDatasetDestination === 'training' || reading.reviewerRecommendTraining === true)
    );
  }
  if (c === 'test_data') return reading.reviewerDatasetDestination === 'test';
  return true;
}

function matchesCorrectedFilter(reading, corrected) {
  if (!isValidReading(reading)) return false;
  const f = String(corrected || 'all').trim().toLowerCase();
  if (f === 'all') return true;
  const isCorrected =
    reading.hadUserCorrection === true ||
    (typeof reading.readsCorrectedCount === 'number' && reading.readsCorrectedCount > 0);
  if (f === 'yes') return isCorrected;
  if (f === 'no') return !isCorrected;
  return true;
}

function compareForSort(a, b, sort) {
  if (!isValidReading(a)) return 1;
  if (!isValidReading(b)) return -1;
  const dayA = readingDayKey(a);
  const dayB = readingDayKey(b);
  const cmp = dayA.localeCompare(dayB);
  if (cmp !== 0) {
    return sort === 'date_desc' ? -cmp : cmp;
  }
  return String(a.id).localeCompare(String(b.id));
}

/**
 * @param {import('./sessionIndex/metadataMapping.js').sessionItemToReading extends Function ? object : object} item
 */
function itemToReading(item) {
  return sessionItemToReading(item, { images: [] });
}

/**
 * @param {object} opts
 * @param {import('./sessionIndex/dynamoStore.js').createSessionIndexStore extends Function ? object : object} opts.sessionIndex
 * @param {string} opts.workType
 * @param {'field_test'|'awaiting_review'} opts.pool
 */
export async function loadPoolReadings({ sessionIndex, workType, pool }) {
  if (!sessionIndex?.enabled) {
    throw new Error('Dynamo session index is not enabled.');
  }
  const wt = String(workType || '1000').trim() || '1000';
  if (pool === 'field_test') {
    const rows = await sessionIndex.queryReadings('field', wt);
    return normalizePoolRows(rows).filter(isFieldTestReading);
  }
  const rows =
    typeof sessionIndex.queryReadingsByFolderStatus === 'function'
      ? await sessionIndex.queryReadingsByFolderStatus(wt, 'incorrect_new', ['field', 'simulator'])
      : await sessionIndex.queryReadings('all', wt);
  return normalizePoolRows(rows).filter(isAwaitingReviewerReview);
}

/** Dynamo `queryReadings*` already returns portal readings; accept raw index items too. */
function normalizePoolRows(rows) {
  return (rows || [])
    .map((row) => (isValidReading(row) ? row : itemToReading(row)))
    .filter(isValidReading);
}

/**
 * @param {import('../src/services/api.js').S3MeterReading[]} readings
 * @param {object} rules
 * @param {Set<string>} [excludeSessionIds]
 */
export function filterPoolReadings(readings, rules, excludeSessionIds = new Set()) {
  const sort = rules?.sort === 'date_desc' ? 'date_desc' : 'date_asc';
  let list = (readings || []).filter((r) => {
    if (!isValidReading(r)) return false;
    if (excludeSessionIds.has(String(r.id))) return false;
    if (!matchesDateRange(r, rules?.dateFrom, rules?.dateTo)) return false;
    if (!matchesCohort(r, rules?.cohort)) return false;
    if (!matchesCorrectedFilter(r, rules?.corrected)) return false;
    return true;
  });
  list = [...list].sort((a, b) => compareForSort(a, b, sort));
  const cap = Math.max(0, parseInt(String(rules?.firstN ?? '0'), 10) || 0);
  const totalMatching = list.length;
  if (cap > 0) list = list.slice(0, cap);
  return { selected: list, totalMatching };
}

export function splitSessionIdsAmongAssignees(sessionIds, assigneeEmails, splitMode = 'equal') {
  const emails = assigneeEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) return [];
  const ids = [...sessionIds];
  if (splitMode !== 'equal' || emails.length === 1) {
    const per = Math.ceil(ids.length / emails.length);
    return emails.map((email, i) => ({
      assigneeEmail: email,
      sessionIds: ids.slice(i * per, (i + 1) * per),
    }));
  }
  const base = Math.floor(ids.length / emails.length);
  let rem = ids.length % emails.length;
  const slices = [];
  let offset = 0;
  for (let i = 0; i < emails.length; i++) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    slices.push({ assigneeEmail: emails[i], sessionIds: ids.slice(offset, offset + size) });
    offset += size;
  }
  return slices;
}

export function batchProgressForSessions(readingsById, sessionIds) {
  let reviewed = 0;
  for (const id of sessionIds) {
    const r = readingsById.get(String(id));
    if (!r) continue;
    if (r.isManuallyReviewed === true || !isAwaitingReviewerReview(r)) reviewed += 1;
  }
  return { reviewed, total: sessionIds.length, remaining: sessionIds.length - reviewed };
}
