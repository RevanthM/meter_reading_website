/**
 * Derive field-test analytics fields from iOS metadata.json (no separate manifest).
 */
import { normalizeFieldTestCaptureTrigger } from './fieldTestCaptureTrigger.js';

const ON_TICK_EPSILON = 0.2;

const CODE_TO_DIFFICULTY = {
  d1: 'normal',
  d2: 'difficult',
  d3: 'very_difficult',
};

function isOnTick(position) {
  const p = Number(position);
  if (!Number.isFinite(p)) return false;
  return Math.abs(p - Math.round(p)) < ON_TICK_EPSILON;
}

function difficultyToCode(difficulty) {
  const d = String(difficulty || 'normal').trim().toLowerCase();
  if (d === 'difficult') return 'd2';
  if (d === 'very_difficult' || d === 'very difficult') return 'd3';
  return 'd1';
}

function tierFromOnTickCount(count) {
  if (count >= 2) return 'very_difficult';
  if (count >= 1) return 'difficult';
  return 'normal';
}

function normalizeDifficulty(raw) {
  const d = String(raw || 'normal').trim().toLowerCase();
  if (d === 'difficult') return 'difficult';
  if (d === 'very_difficult' || d === 'very difficult') return 'very_difficult';
  return 'normal';
}

function finalReadingFromMetadata(metadata) {
  const raw = String(
    metadata.final_reading ?? metadata.user_correction ?? metadata.ml_prediction ?? '',
  ).replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

/** Model reading before user review (never prefer post-correction ml_prediction). */
function mlBaselineReadingFromMetadata(metadata) {
  const raw = String(metadata?.ml_raw_prediction ?? metadata?.ml_prediction ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

/** Dial numbers (1–4) the reviewer marked as model-incorrect. */
export function incorrectDialNumbersFromItem(item) {
  return Array.isArray(item?.user_incorrect_dial_numbers)
    ? item.user_incorrect_dial_numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 4)
    : [];
}

/** Explicit reviewer flags only — do not infer from ml vs final string diff. */
export function countReadsCorrectedFromItem(item) {
  const incorrect = incorrectDialNumbersFromItem(item);
  if (incorrect.length > 0) return incorrect.length;

  const correctedPos = Array.isArray(item?.user_corrected_positions)
    ? item.user_corrected_positions.filter((n) => Number.isInteger(n))
    : [];
  if (correctedPos.length > 0) return correctedPos.length;

  const stored = Number(item?.reads_corrected_count);
  if (Number.isFinite(stored) && stored > 0) return stored;

  return 0;
}

/** True when the on-device model needed no dial corrections (field-test ground truth). */
export function captureModelReadingCorrect(item) {
  return countReadsCorrectedFromItem(item) === 0;
}

/**
 * Include in field-test Results metrics only when the reviewer chose Correct or Incorrect.
 * Excludes No dials detected, Not sure, and other non-verdict outcomes.
 */
export function isFieldTestScorableCapture(item) {
  if (!item) return false;
  if (item.field_test_capture === true) return true;

  const feedback = String(item.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'correct' || feedback === 'incorrect') return true;

  const status = String(item.folder_status ?? '').trim().toLowerCase();
  if (status === 'correct') return true;
  if (status.startsWith('incorrect')) return true;

  return false;
}

/** @param {object[]} items */
export function filterFieldTestScorableSessions(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(isFieldTestScorableCapture);
}

/** Dial 4 bill-lower: predicted one digit below expected still counts correct (matches iOS). */
function dialDigitMatches(expected, predicted, dialNumber) {
  if (expected === predicted) return true;
  if (dialNumber === 4 && predicted < expected) return true;
  return false;
}

/**
 * @param {object} metadata — parsed metadata.json
 */
export function deriveFieldTestFromMetadata(metadata) {
  const dialDetails = Array.isArray(metadata?.dial_details) ? metadata.dial_details : [];
  const mlBaseline = mlBaselineReadingFromMetadata(metadata);
  let onTickCount = 0;
  /** @type {Array<{ dial: number, expected: number|null, predicted: number|null, match: boolean|null, onTick: boolean }>} */
  const perDial = [];

  for (let i = 0; i < dialDetails.length; i++) {
    const d = dialDetails[i];
    if (!d || typeof d !== 'object') continue;
    const dialNum = Number.isInteger(d.dial) && d.dial >= 1 ? d.dial : i + 1;
    const angleToDigit = d.stage_3?.angle_to_digit;
    const onTick = angleToDigit != null && isOnTick(angleToDigit);
    if (onTick) onTickCount += 1;

    let predicted = d.prediction;
    if (!Number.isFinite(Number(predicted)) && d.stage_3?.digit != null) {
      predicted = d.stage_3.digit;
    }
    let predDigit = Number.isFinite(Number(predicted)) ? (((Math.round(Number(predicted)) % 10) + 10) % 10) : null;
    const mlCh = mlBaseline[dialNum - 1];
    if (mlCh && /\d/.test(mlCh)) {
      predDigit = parseInt(mlCh, 10);
    }

    perDial.push({
      dial: dialNum,
      expected: null,
      predicted: predDigit,
      match: null,
      onTick,
    });
  }

  const finalReading = finalReadingFromMetadata(metadata);
  for (const row of perDial) {
    const ch = finalReading[row.dial - 1];
    if (ch && /\d/.test(ch)) {
      row.expected = parseInt(ch, 10);
      if (row.predicted != null) {
        row.match = dialDigitMatches(row.expected, row.predicted, row.dial);
      }
    }
  }

  let imageDifficulty = normalizeDifficulty(metadata?.image_difficulty);
  if (!metadata?.image_difficulty) {
    imageDifficulty = tierFromOnTickCount(onTickCount);
  }

  const incorrectDialNumbers = Array.isArray(metadata?.user_incorrect_dial_numbers)
    ? metadata.user_incorrect_dial_numbers.filter((n) => Number.isInteger(n))
    : [];
  const correctedPositions = Array.isArray(metadata?.user_corrected_positions)
    ? metadata.user_corrected_positions.filter((n) => Number.isInteger(n))
    : [];

  let readsCorrected =
    incorrectDialNumbers.length > 0
      ? incorrectDialNumbers.length
      : correctedPositions.length > 0
        ? correctedPositions.length
        : 0;

  const hadUserCorrection = readsCorrected > 0;

  const dialCount =
    typeof metadata?.dial_count === 'number' && Number.isFinite(metadata.dial_count)
      ? metadata.dial_count
      : perDial.length || 4;

  let readsCorrect = 0;
  let readsWithGroundTruth = 0;
  for (const row of perDial) {
    if (row.expected == null) continue;
    readsWithGroundTruth += 1;
    if (row.match === true) readsCorrect += 1;
  }

  return {
    image_difficulty: imageDifficulty,
    on_tick_dial_count: onTickCount,
    reads_corrected_count: readsCorrected,
    had_user_correction: hadUserCorrection,
    final_reading: finalReading || null,
    per_dial_compact: JSON.stringify(perDial),
    field_test_capture:
      String(metadata?.upload_mode || '').trim().toLowerCase() === 'field' &&
      metadata?.is_manually_reviewed === true,
    dial_count: dialCount,
    reads_with_ground_truth: readsWithGroundTruth,
    reads_correct: readsCorrect,
  };
}

export function isFieldUploadMetadata(metadata) {
  return String(metadata?.upload_mode || '').trim().toLowerCase() === 'field';
}

/** @param {object} item — Dynamo session item */
export function perDialFromItem(item) {
  if (item?.per_dial_compact) {
    try {
      const parsed = JSON.parse(String(item.per_dial_compact));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(item?.dial_details)) {
    try {
      const parsed = JSON.parse(
        deriveFieldTestFromMetadata({
          dial_details: item.dial_details,
          final_reading: item.final_reading,
          user_correction: item.user_correction,
          ml_prediction: item.ml_prediction,
          user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
          user_corrected_positions: item.user_corrected_positions,
        }).per_dial_compact,
      );
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Build CSV-style per-image row for portal charts. */
export function sessionItemToPerImageRow(item) {
  const difficulty = normalizeDifficulty(item.image_difficulty);
  const code = difficultyToCode(difficulty);
  const finalReading = String(item.final_reading || item.user_correction || item.ml_prediction || '')
    .replace(/\D/g, '')
    .padStart(4, '0')
    .slice(-4);
  let perDial = [];
  if (Array.isArray(item.dial_details) && item.dial_details.length > 0) {
    try {
      perDial = JSON.parse(
        deriveFieldTestFromMetadata({
          dial_details: item.dial_details,
          final_reading: item.final_reading,
          user_correction: item.user_correction,
          ml_prediction: item.ml_prediction,
          ml_raw_prediction: item.ml_raw_prediction,
          user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
          user_corrected_positions: item.user_corrected_positions,
        }).per_dial_compact,
      );
    } catch {
      perDial = [];
    }
  }
  if (!perDial.length) {
    perDial = perDialFromItem(item);
  }

  const overallMatch = finalReading ? String(captureModelReadingCorrect(item)) : '';
  const predicted = mlBaselineReadingFromMetadata(item);

  const row = {
    s3_key: item.primary_image_key || `${item.s3_session_prefix || ''}original.jpg`,
    filename: (item.primary_image_key || 'original.jpg').split('/').pop() || 'original.jpg',
    session_id: item.session_id,
    image_difficulty_code: code,
    image_difficulty: difficulty,
    predicted_reading: predicted,
    expected_reading_from_filename: finalReading,
    overall_reading_match: overallMatch,
    captured_by: item.user_name || '',
    captured_at: item.captured_at || '',
    average_confidence: item.confidence != null ? String(item.confidence) : '',
    dial_count: String(item.dial_count ?? perDial.length ?? 4),
    reads_corrected_count: String(countReadsCorrectedFromItem(item)),
    incorrect_dial_numbers: incorrectDialNumbersFromItem(item).join(','),
  };

  const dialDetails = Array.isArray(item.dial_details) ? item.dial_details : [];

  for (let d = 1; d <= 4; d++) {
    const pd = perDial.find((x) => x.dial === d) || perDial[d - 1];
    const dd = dialDetails.find((x) => x && x.dial === d) || dialDetails[d - 1];
    if (!pd) {
      row[`dial${d}_expected_digit`] = finalReading[d - 1] ?? '';
      row[`dial${d}_predicted_digit`] = '';
      row[`dial${d}_digit_match`] = '';
      continue;
    }
    row[`dial${d}_expected_digit`] = pd.expected != null ? String(pd.expected) : '';
    row[`dial${d}_predicted_digit`] = pd.predicted != null ? String(pd.predicted) : '';
    row[`dial${d}_digit_match`] = pd.match != null ? (pd.match ? 'true' : 'false') : '';
    if (dd?.confidence != null && Number.isFinite(Number(dd.confidence))) {
      row[`dial${d}_composite_confidence`] = String(dd.confidence);
      row[`dial${d}_confidence`] = String(dd.confidence);
    } else if (item.confidence != null && Number.isFinite(Number(item.confidence))) {
      row[`dial${d}_composite_confidence`] = String(item.confidence);
      row[`dial${d}_confidence`] = String(item.confidence);
    }
  }

  return row;
}

export function fieldTestCaptureToListItem(reading) {
  const difficulty = normalizeDifficulty(reading.imageDifficulty);
  return {
    sessionId: reading.id,
    s3SessionPrefix: reading.s3SessionPrefix,
    s3Bucket: reading.bucket,
    primaryImageKey: reading.primaryImageKey,
    capturedAt: reading.dateOfReading,
    capturedBy: reading.userName || '',
    finalReading:
      String(reading.expectedValue || reading.meterValue || '')
        .replace(/\D/g, '')
        .padStart(4, '0')
        .slice(-4) || null,
    predictedReading: reading.meterValue || null,
    imageDifficulty: difficulty,
    onTickDialCount: reading.onTickDialCount ?? null,
    readsCorrectedCount: reading.readsCorrectedCount ?? 0,
    hadUserCorrection: reading.hadUserCorrection === true,
    dialCount: reading.dialCount ?? 4,
    confidence: reading.confidence ?? null,
    appVersion: reading.appVersion || null,
    captureTrigger: normalizeFieldTestCaptureTrigger(reading) || null,
    imageSource: reading.imageSource || null,
  };
}
