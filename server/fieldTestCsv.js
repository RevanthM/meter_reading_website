/**
 * Generate field-test cycle CSV exports (iOS unit-test CSV–compatible sections + location/tilt).
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { sessionItemToPerImageRow } from './fieldTestDerive.js';

export function escapeCsvField(raw) {
  const s = raw == null ? '' : String(raw);
  const doubled = s.replace(/"/g, '""');
  if (/[",\n\r]/.test(doubled)) return `"${doubled}"`;
  return doubled;
}

function summarySectionRows(rollup, cycle) {
  const s = rollup.summary || {};
  const rows = [
    ['section', 'FIELD_CAPTURE_SUMMARY'],
    ['cycle_id', cycle.id],
    ['cycle_name', cycle.name],
    ['cycle_start_date', cycle.startDate],
    ['cycle_end_date', cycle.endDate],
    ['work_type', cycle.workType || rollup.workType || ''],
    ['generated_utc', new Date().toISOString()],
    ['captures_processed', String(rollup.captureCount ?? 0)],
    ['with_ground_truth', String(s.withGroundTruth ?? '')],
    ['correct_readings', String(s.correct ?? '')],
    ['accuracy_percent', s.accuracyPercent != null ? String(s.accuracyPercent) : ''],
    ['average_confidence', s.average_confidence != null ? String(s.average_confidence) : ''],
    ['total_reads', String(rollup.totalReads ?? '')],
    ['reads_correct', String(rollup.readsCorrect ?? '')],
    ['reads_corrected', String(rollup.readsCorrected ?? '')],
    ['correction_percent', rollup.correctionPct != null ? String(rollup.correctionPct) : ''],
    ['', ''],
    ['section', 'IMAGE_DIFFICULTY_BREAKDOWN'],
    ['image_difficulty_note', 'd1/d2/d3 = normal / difficult / very_difficult'],
  ];

  for (const tier of rollup.imageDifficultyBreakdown || []) {
    const code = tier.code || 'd1';
    rows.push([`${code}_image_count`, String(tier.imageCount ?? 0)]);
    rows.push([`${code}_with_ground_truth`, String(tier.withGroundTruth ?? 0)]);
    rows.push([`${code}_correct`, String(tier.correct ?? 0)]);
    rows.push([
      `${code}_accuracy_percent`,
      tier.accuracyPct != null ? String(tier.accuracyPct) : '',
    ]);
    rows.push([
      `${code}_average_confidence`,
      tier.confidencePct != null ? String(tier.confidencePct) : '',
    ]);
  }

  rows.push(['', '']);
  rows.push(['section', 'PER_IMAGE_PER_DIAL_ROWS']);
  return rows.map(([k, v]) => `${escapeCsvField(k)},${escapeCsvField(v)}`).join('\n');
}

function locationColumns(loc) {
  if (!loc || typeof loc !== 'object') {
    return {
      capture_latitude: '',
      capture_longitude: '',
      capture_accuracy_m: '',
      capture_place_label: '',
      capture_coordinate_label: '',
      capture_location_at: '',
    };
  }
  return {
    capture_latitude: loc.latitude != null ? String(loc.latitude) : '',
    capture_longitude: loc.longitude != null ? String(loc.longitude) : '',
    capture_accuracy_m: loc.accuracy_m != null ? String(loc.accuracy_m) : '',
    capture_place_label: loc.place_label != null ? String(loc.place_label) : '',
    capture_coordinate_label: loc.coordinate_label != null ? String(loc.coordinate_label) : '',
    capture_location_at: loc.captured_at != null ? String(loc.captured_at) : '',
  };
}

function tiltColumns(tilt) {
  if (!tilt || typeof tilt !== 'object') {
    return {
      tilt_roll_deg: '',
      tilt_pitch_deg: '',
      tilt_is_level: '',
      tilt_level_dot_x_norm: '',
      tilt_level_dot_y_norm: '',
      tilt_captured_at: '',
    };
  }
  return {
    tilt_roll_deg: tilt.roll_deg != null ? String(tilt.roll_deg) : '',
    tilt_pitch_deg: tilt.pitch_deg != null ? String(tilt.pitch_deg) : '',
    tilt_is_level: tilt.is_level != null ? String(tilt.is_level) : '',
    tilt_level_dot_x_norm:
      tilt.level_dot_offset_x_norm != null ? String(tilt.level_dot_offset_x_norm) : '',
    tilt_level_dot_y_norm:
      tilt.level_dot_offset_y_norm != null ? String(tilt.level_dot_offset_y_norm) : '',
    tilt_captured_at: tilt.captured_at != null ? String(tilt.captured_at) : '',
  };
}

function pointCoord(p, axis) {
  if (!p || typeof p !== 'object') return '';
  const v = p[axis] ?? p[axis === 'x' ? 'dx' : 'dy'];
  return v != null && Number.isFinite(Number(v)) ? String(v) : '';
}

function dialDetailColumns(dd, dialNum) {
  const p = `dial${dialNum}_`;
  const out = {
    [`${p}user_dial_correct`]: dd?.user_dial_correct != null ? String(dd.user_dial_correct) : '',
    [`${p}direction`]: dd?.direction != null ? String(dd.direction) : '',
  };
  const s1 = dd?.stage_1 ?? dd?.stage1;
  const s2 = dd?.stage_2 ?? dd?.stage2;
  const s3 = dd?.stage_3 ?? dd?.stage3;
  if (s1?.bounding_box) {
    const bb = s1.bounding_box;
    out[`${p}stage1_bbox_x`] = bb.x != null ? String(bb.x) : '';
    out[`${p}stage1_bbox_y`] = bb.y != null ? String(bb.y) : '';
    out[`${p}stage1_bbox_w`] = bb.width != null ? String(bb.width) : '';
    out[`${p}stage1_bbox_h`] = bb.height != null ? String(bb.height) : '';
    out[`${p}stage1_detection_confidence`] =
      s1.detection_confidence != null ? String(s1.detection_confidence) : '';
  }
  if (s2) {
    const center = s2.dial_center ?? s2.dialCenter;
    const tip = s2.needle_tip ?? s2.needleTip;
    const zero = s2.zero_mark ?? s2.zeroMark;
    out[`${p}stage2_center_x`] = pointCoord(center, 'x');
    out[`${p}stage2_center_y`] = pointCoord(center, 'y');
    out[`${p}stage2_needle_tip_x`] = pointCoord(tip, 'x');
    out[`${p}stage2_needle_tip_y`] = pointCoord(tip, 'y');
    out[`${p}stage2_zero_mark_x`] = pointCoord(zero, 'x');
    out[`${p}stage2_zero_mark_y`] = pointCoord(zero, 'y');
    out[`${p}stage2_kp_confidence`] =
      s2.keypoint_confidence != null ? String(s2.keypoint_confidence) : '';
  }
  if (s3) {
    out[`${p}stage3_angular_offset_deg`] =
      s3.angular_offset_deg != null
        ? String(s3.angular_offset_deg)
        : s3.angularOffsetDeg != null
          ? String(s3.angularOffsetDeg)
          : '';
    out[`${p}stage3_normalized_angle_deg`] =
      s3.normalized_dial_angle_deg != null
        ? String(s3.normalized_dial_angle_deg)
        : s3.normalizedDialAngleDeg != null
          ? String(s3.normalizedDialAngleDeg)
          : '';
    out[`${p}stage3_angle_to_digit`] =
      s3.angle_to_digit != null
        ? String(s3.angle_to_digit)
        : s3.angleToDigit != null
          ? String(s3.angleToDigit)
          : '';
    out[`${p}stage3_final_digit`] = s3.digit != null ? String(s3.digit) : '';
  }
  return out;
}

/** @param {object} item — Dynamo session item (optionally merged with metadata.json) */
export function buildFieldTestExportRow(item) {
  const base = sessionItemToPerImageRow(item);
  const row = {
    ...base,
    session_id: item.session_id || '',
    s3_session_prefix: item.s3_session_prefix || '',
    work_type: item.work_type_code || item.portal_work_type || '',
    upload_mode: item.upload_mode || 'field',
    image_source: item.image_source || '',
    app_version: item.app_version != null ? String(item.app_version) : '',
    on_tick_dial_count: item.on_tick_dial_count != null ? String(item.on_tick_dial_count) : '',
    had_user_correction: item.had_user_correction === true ? 'true' : 'false',
    is_correct: item.is_correct === true ? 'true' : item.is_correct === false ? 'false' : '',
    feedback_type: item.feedback_type || '',
    is_manually_reviewed: item.is_manually_reviewed === true ? 'true' : 'false',
    ml_raw_prediction: item.ml_raw_prediction || '',
    user_correction: item.user_correction || '',
    final_reading: item.final_reading || '',
    processing_time_ms:
      item.processing_time_ms != null ? String(item.processing_time_ms) : '',
    portal_review_notes:
      item.portal_review_notes != null ? String(item.portal_review_notes) : '',
    ...locationColumns(item.capture_location),
    ...tiltColumns(item.capture_device_tilt),
  };

  const dialDetails = Array.isArray(item.dial_details) ? item.dial_details : [];
  for (let d = 1; d <= 4; d++) {
    const dd = dialDetails.find((x) => x && x.dial === d) || dialDetails[d - 1];
    Object.assign(row, dialDetailColumns(dd, d));
  }
  return row;
}

const PER_IMAGE_HEADER = [
  'session_id',
  's3_session_prefix',
  's3_key',
  'filename',
  'work_type',
  'upload_mode',
  'image_source',
  'app_version',
  'capture_latitude',
  'capture_longitude',
  'capture_accuracy_m',
  'capture_place_label',
  'capture_coordinate_label',
  'capture_location_at',
  'tilt_roll_deg',
  'tilt_pitch_deg',
  'tilt_is_level',
  'tilt_level_dot_x_norm',
  'tilt_level_dot_y_norm',
  'tilt_captured_at',
  'image_difficulty_code',
  'image_difficulty',
  'on_tick_dial_count',
  'predicted_reading',
  'expected_reading_from_filename',
  'overall_reading_match',
  'ml_raw_prediction',
  'user_correction',
  'final_reading',
  'had_user_correction',
  'is_correct',
  'feedback_type',
  'is_manually_reviewed',
  'captured_by',
  'captured_at',
  'processing_time_ms',
  'average_confidence',
  'dial_count',
  'reads_corrected_count',
  'portal_review_notes',
  'dial1_expected_digit',
  'dial1_predicted_digit',
  'dial1_digit_match',
  'dial1_composite_confidence',
  'dial1_user_dial_correct',
  'dial1_direction',
  'dial1_stage2_center_x',
  'dial1_stage2_center_y',
  'dial1_stage2_needle_tip_x',
  'dial1_stage2_needle_tip_y',
  'dial1_stage2_zero_mark_x',
  'dial1_stage2_zero_mark_y',
  'dial1_stage2_kp_confidence',
  'dial1_stage3_angular_offset_deg',
  'dial1_stage3_normalized_angle_deg',
  'dial1_stage3_angle_to_digit',
  'dial1_stage3_final_digit',
  'dial2_expected_digit',
  'dial2_predicted_digit',
  'dial2_digit_match',
  'dial2_composite_confidence',
  'dial2_user_dial_correct',
  'dial2_direction',
  'dial2_stage2_center_x',
  'dial2_stage2_center_y',
  'dial2_stage2_needle_tip_x',
  'dial2_stage2_needle_tip_y',
  'dial2_stage2_zero_mark_x',
  'dial2_stage2_zero_mark_y',
  'dial2_stage2_kp_confidence',
  'dial2_stage3_angular_offset_deg',
  'dial2_stage3_normalized_angle_deg',
  'dial2_stage3_angle_to_digit',
  'dial2_stage3_final_digit',
  'dial3_expected_digit',
  'dial3_predicted_digit',
  'dial3_digit_match',
  'dial3_composite_confidence',
  'dial3_user_dial_correct',
  'dial3_direction',
  'dial3_stage2_center_x',
  'dial3_stage2_center_y',
  'dial3_stage2_needle_tip_x',
  'dial3_stage2_needle_tip_y',
  'dial3_stage2_zero_mark_x',
  'dial3_stage2_zero_mark_y',
  'dial3_stage2_kp_confidence',
  'dial3_stage3_angular_offset_deg',
  'dial3_stage3_normalized_angle_deg',
  'dial3_stage3_angle_to_digit',
  'dial3_stage3_final_digit',
  'dial4_expected_digit',
  'dial4_predicted_digit',
  'dial4_digit_match',
  'dial4_composite_confidence',
  'dial4_user_dial_correct',
  'dial4_direction',
  'dial4_stage2_center_x',
  'dial4_stage2_center_y',
  'dial4_stage2_needle_tip_x',
  'dial4_stage2_needle_tip_y',
  'dial4_stage2_zero_mark_x',
  'dial4_stage2_zero_mark_y',
  'dial4_stage2_kp_confidence',
  'dial4_stage3_angular_offset_deg',
  'dial4_stage3_normalized_angle_deg',
  'dial4_stage3_angle_to_digit',
  'dial4_stage3_final_digit',
];

/**
 * @param {object} cycle
 * @param {object} rollup — from buildFieldTestRollup
 * @param {object[]} sessionItems
 */
export function buildFieldTestCycleCsv(cycle, rollup, sessionItems) {
  const exportRows = sessionItems.map((item) => buildFieldTestExportRow(item));
  const parts = [summarySectionRows(rollup, cycle), PER_IMAGE_HEADER.join(',')];
  for (const row of exportRows) {
    parts.push(PER_IMAGE_HEADER.map((h) => escapeCsvField(row[h] ?? '')).join(','));
  }
  return `${parts.join('\n')}\n`;
}

/**
 * Merge metadata.json fields missing from Dynamo (tilt, full dial_details).
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
export async function enrichFieldTestItemsFromMetadata(s3Client, bucket, items, { concurrency = 10 } = {}) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const batch = await Promise.all(
      chunk.map(async (item) => {
        const prefix = item.s3_session_prefix;
        if (!prefix) return item;
        try {
          const key = `${String(prefix).replace(/\/?$/, '/')}/metadata.json`;
          const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const text = await obj.Body.transformToString();
          const meta = JSON.parse(text);
          return {
            ...item,
            capture_location: item.capture_location || meta.capture_location || null,
            capture_device_tilt: meta.capture_device_tilt || null,
            dial_details:
              Array.isArray(item.dial_details) && item.dial_details.length > 0
                ? item.dial_details
                : meta.dial_details || item.dial_details,
            processing_time_ms: item.processing_time_ms ?? meta.processing_time_ms,
            portal_review_notes: item.portal_review_notes ?? meta.portal_review_notes,
            image_difficulty: item.image_difficulty ?? meta.image_difficulty,
            on_tick_dial_count: item.on_tick_dial_count ?? meta.on_tick_dial_count,
          };
        } catch {
          return item;
        }
      }),
    );
    out.push(...batch);
  }
  return out;
}
