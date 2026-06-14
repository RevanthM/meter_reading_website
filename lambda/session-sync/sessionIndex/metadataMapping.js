import { inferPortalWorkTypeFromMetadata } from './workTypes.js';
import { inferStatusAndSourceFromSessionPrefix, normalizeS3SessionPrefix } from './prefixInfer.js';
import {
  formatCaptureLocationFromMetadata,
  normalizeCaptureDeviceTilt,
  normalizeCaptureCompass,
  normalizeCaptureLocation,
  normalizeDialDetailsFromMetadata,
  normalizeSessionConfidenceValue,
} from './normalize.js';

export function buildGsi1Pk(portalWorkType, folderStatus, sourceType) {
  return `WT#${portalWorkType}#ST#${folderStatus}#SRC#${sourceType}`;
}

export function buildGsi1Sk(capturedAt, sessionId) {
  const ts = capturedAt && String(capturedAt).trim() ? String(capturedAt).trim() : '1970-01-01T00:00:00.000Z';
  return `${ts}#${sessionId}`;
}

/**
 * Build a DynamoDB item from metadata.json + S3 context.
 * @param {object} metadata — parsed metadata.json
 * @param {object} ctx
 */
export function metadataToSessionItem(metadata, ctx) {
  const sessionId = String(metadata.session_id || ctx.sessionId || '').trim();
  if (!sessionId) throw new Error('metadata missing session_id');

  const s3SessionPrefix = normalizeS3SessionPrefix(ctx.s3SessionPrefix);
  const { status, sourceType } = ctx.folderStatus
    ? { status: ctx.folderStatus, sourceType: ctx.sourceType || inferStatusAndSourceFromSessionPrefix(s3SessionPrefix).sourceType }
    : inferStatusAndSourceFromSessionPrefix(s3SessionPrefix);

  const portalWorkType = inferPortalWorkTypeFromMetadata(metadata, ctx.portalWorkType || '1000');
  const capturedAt = metadata.timestamp || new Date().toISOString();
  const dialDetails = normalizeDialDetailsFromMetadata(
    metadata.dial_details,
    metadata.ml_prediction,
    metadata.user_correction,
  );

  const item = {
    session_id: sessionId,
    s3_bucket: ctx.s3Bucket,
    s3_session_prefix: s3SessionPrefix,
    portal_work_type: portalWorkType,
    folder_status: status,
    source_type: sourceType,
    captured_at: capturedAt,
    gsi1pk: buildGsi1Pk(portalWorkType, status, sourceType),
    gsi1sk: buildGsi1Sk(capturedAt, sessionId),
    work_type_code: metadata.work_type != null ? String(metadata.work_type) : null,
    work_type_name: metadata.work_type_name != null ? String(metadata.work_type_name) : null,
    upload_mode: metadata.upload_mode != null ? String(metadata.upload_mode) : null,
    image_source: metadata.image_source != null ? String(metadata.image_source) : null,
    capture_trigger:
      metadata.capture_trigger != null ? String(metadata.capture_trigger).trim().toLowerCase() : null,
    user_name: metadata.user_name != null ? String(metadata.user_name) : null,
    user_email: metadata.user_email != null ? String(metadata.user_email) : null,
    feedback_type: metadata.feedback_type != null ? String(metadata.feedback_type) : null,
    ml_prediction: metadata.ml_prediction != null ? String(metadata.ml_prediction) : null,
    ml_raw_prediction: metadata.ml_raw_prediction != null ? String(metadata.ml_raw_prediction) : null,
    user_correction: metadata.user_correction != null ? String(metadata.user_correction) : null,
    confidence: normalizeSessionConfidenceValue(metadata.confidence) ?? null,
    processing_time_ms:
      typeof metadata.processing_time_ms === 'number' && Number.isFinite(metadata.processing_time_ms)
        ? metadata.processing_time_ms
        : null,
    dial_count:
      typeof metadata.dial_count === 'number' && Number.isFinite(metadata.dial_count)
        ? metadata.dial_count
        : Array.isArray(dialDetails)
          ? dialDetails.length
          : null,
    dial_details: dialDetails ?? null,
    app_version: metadata.app_version != null ? String(metadata.app_version) : null,
    condition_code: metadata.condition_code != null ? String(metadata.condition_code) : null,
    is_correct: metadata.is_correct === true,
    is_manually_reviewed:
      metadata.is_manually_reviewed === true || metadata.is_human_reviewed === true,
    portal_review_notes:
      metadata.portal_review_notes != null ? String(metadata.portal_review_notes) : null,
    portal_metadata_updated_at:
      metadata.portal_metadata_updated_at != null ? String(metadata.portal_metadata_updated_at) : null,
    portal_metadata_updated_by:
      metadata.portal_metadata_updated_by != null ? String(metadata.portal_metadata_updated_by) : null,
    review_assignment_batch_id:
      typeof metadata.review_assignment_batch_id === 'string' && metadata.review_assignment_batch_id.trim()
        ? metadata.review_assignment_batch_id.trim().slice(0, 64)
        : null,
    review_assigned_to:
      typeof metadata.review_assigned_to === 'string' && metadata.review_assigned_to.trim()
        ? metadata.review_assigned_to.trim().slice(0, 320)
        : null,
    review_assigned_at:
      typeof metadata.review_assigned_at === 'string' ? metadata.review_assigned_at : null,
    review_assigned_by:
      typeof metadata.review_assigned_by === 'string' && metadata.review_assigned_by.trim()
        ? metadata.review_assigned_by.trim().slice(0, 320)
        : null,
    reviewer_dataset_destination:
      metadata.reviewer_dataset_destination === 'training' || metadata.reviewer_dataset_destination === 'test'
        ? metadata.reviewer_dataset_destination
        : metadata.reviewer_recommend_training === true
          ? 'training'
          : null,
    image_difficulty:
      metadata.image_difficulty === 'normal' ||
      metadata.image_difficulty === 'difficult' ||
      metadata.image_difficulty === 'very_difficult'
        ? metadata.image_difficulty
        : null,
    test_data_review_status:
      metadata.test_data_review_status === 'approved' || metadata.test_data_review_status === 'pending'
        ? metadata.test_data_review_status
        : metadata.reviewer_dataset_destination === 'test' && metadata.test_data_review_status !== 'approved'
          ? 'pending'
          : null,
    test_data_unit_test_s3_key:
      typeof metadata.test_data_unit_test_s3_key === 'string' ? metadata.test_data_unit_test_s3_key : null,
    test_data_unit_test_file_name:
      typeof metadata.test_data_unit_test_file_name === 'string' ? metadata.test_data_unit_test_file_name : null,
    test_data_approved_at:
      typeof metadata.test_data_approved_at === 'string' ? metadata.test_data_approved_at : null,
    test_data_approved_by:
      typeof metadata.test_data_approved_by === 'string' ? metadata.test_data_approved_by : null,
    test_data_submitted_at:
      typeof metadata.test_data_submitted_at === 'string' ? metadata.test_data_submitted_at : null,
    test_data_submitted_by:
      typeof metadata.test_data_submitted_by === 'string' ? metadata.test_data_submitted_by : null,
    manual_label_pending: metadata.manual_label_pending === true,
    primary_image_key:
      typeof metadata.primary_image_key === 'string' && metadata.primary_image_key.trim()
        ? metadata.primary_image_key.trim()
        : typeof metadata.primary_image_file === 'string' && metadata.primary_image_file.trim()
          ? `${s3SessionPrefix}${metadata.primary_image_file.trim()}`
          : typeof ctx.primaryImageKey === 'string' && ctx.primaryImageKey.trim()
            ? ctx.primaryImageKey.trim()
            : null,
    image_count:
      typeof ctx.imageCount === 'number' && Number.isFinite(ctx.imageCount) ? ctx.imageCount : null,
    metadata_etag: ctx.metadataEtag != null ? String(ctx.metadataEtag) : null,
    last_metadata_sync_at: new Date().toISOString(),
    ingest_source: ctx.ingestSource || 's3_lambda',
    updated_at: new Date().toISOString(),
  };

  if (metadata.capture_location && typeof metadata.capture_location === 'object') {
    item.capture_location = metadata.capture_location;
  }
  if (metadata.capture_device_tilt && typeof metadata.capture_device_tilt === 'object') {
    item.capture_device_tilt = metadata.capture_device_tilt;
  }
  if (metadata.capture_compass && typeof metadata.capture_compass === 'object') {
    item.capture_compass = metadata.capture_compass;
  }

  return item;
}

/** Map a Dynamo item to the portal list/detail reading shape (without presigned images). */
export function sessionItemToReading(item, { images = [] } = {}) {
  if (!item?.session_id) return null;

  const metadata = {
    timestamp: item.captured_at,
    work_type: item.work_type_code,
    upload_mode: item.upload_mode,
    capture_location: item.capture_location,
    capture_device_tilt: item.capture_device_tilt,
    capture_compass: item.capture_compass,
  };

  return {
    id: item.session_id,
    s3SessionPrefix: item.s3_session_prefix,
    dateOfReading: item.captured_at,
    location: formatCaptureLocationFromMetadata(metadata) || 'Location unavailable',
    captureLocation: normalizeCaptureLocation(metadata),
    captureDeviceTilt: normalizeCaptureDeviceTilt(metadata),
    captureCompass: normalizeCaptureCompass(metadata),
    type: item.source_type || 'field',
    status: item.folder_status,
    workType: item.work_type_code || item.portal_work_type || '1000',
    meterValue: item.ml_prediction,
    expectedValue: item.user_correction || undefined,
    rawPrediction: item.ml_raw_prediction,
    isCorrect: item.is_correct,
    confidence: item.confidence ?? undefined,
    processingTimeMs: item.processing_time_ms ?? undefined,
    dialCount: item.dial_count ?? undefined,
    dialDetails: item.dial_details ?? undefined,
    conditionCode: item.condition_code ?? undefined,
    userName: item.user_name || item.user_email || '',
    imageSource: item.image_source || '',
    captureTrigger: item.capture_trigger || '',
    uploadMode: item.upload_mode || '',
    feedbackType: item.feedback_type || '',
    appVersion: item.app_version != null ? String(item.app_version) : '',
    reviewerRecommendTraining: item.reviewer_dataset_destination === 'training',
    reviewerDatasetDestination: item.reviewer_dataset_destination ?? null,
    imageDifficulty: item.image_difficulty ?? null,
    testDataReviewStatus: item.test_data_review_status ?? null,
    testDataUnitTestS3Key: item.test_data_unit_test_s3_key ?? undefined,
    testDataUnitTestFileName: item.test_data_unit_test_file_name ?? undefined,
    testDataApprovedAt: item.test_data_approved_at ?? undefined,
    testDataSubmittedAt: item.test_data_submitted_at ?? undefined,
    testDataSubmittedBy: item.test_data_submitted_by ?? undefined,
    isManuallyReviewed: item.is_manually_reviewed === true,
    portalMetadataUpdatedBy: item.portal_metadata_updated_by ?? undefined,
    portalMetadataUpdatedAt: item.portal_metadata_updated_at ?? undefined,
    reviewAssignmentBatchId: item.review_assignment_batch_id ?? undefined,
    reviewAssignedTo: item.review_assigned_to ?? undefined,
    reviewAssignedAt: item.review_assigned_at ?? undefined,
    reviewAssignedBy: item.review_assigned_by ?? undefined,
    manualLabelPending: item.manual_label_pending === true,
    primaryImageKey: item.primary_image_key ?? undefined,
    comments: item.portal_review_notes != null && item.portal_review_notes !== '' ? String(item.portal_review_notes) : '',
    imageCount: item.image_count ?? (Array.isArray(images) ? images.length : 0),
    images,
    createdAt: item.captured_at,
    updatedAt: item.portal_metadata_updated_at || item.captured_at,
  };
}

/** When duplicate session_id rows exist, prefer test-queue markers and newest portal update. */
export function readingDuplicatePriority(r) {
  let score = 0;
  if (r.reviewerDatasetDestination === 'test') score += 4;
  if (r.testDataReviewStatus === 'approved') score += 8;
  if (r.testDataReviewStatus === 'pending') score += 2;
  if (r.testDataUnitTestS3Key) score += 8;
  const t = Date.parse(r.portalMetadataUpdatedAt || r.dateOfReading || '');
  return { score, time: Number.isFinite(t) ? t : 0 };
}

export function pickPreferredReadingDuplicate(a, b) {
  const pa = readingDuplicatePriority(a);
  const pb = readingDuplicatePriority(b);
  if (pa.score !== pb.score) return pa.score > pb.score ? a : b;
  return pa.time >= pb.time ? a : b;
}

export function dedupeReadings(readings) {
  const byId = new Map();
  for (const r of readings) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
      continue;
    }
    byId.set(r.id, pickPreferredReadingDuplicate(existing, r));
  }
  return [...byId.values()];
}
