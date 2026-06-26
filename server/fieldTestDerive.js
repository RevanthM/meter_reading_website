/**
 * Derive field-test analytics fields from iOS metadata.json (no separate manifest).
 *
 * Capture lifecycle (field test):
 * 1. iOS — user photographs the meter; they either fix dials/readings on device or accept as correct.
 * 2. Portal — reviewer checks the capture; Correct / Incorrect is the field-test layer verdict (Images tab).
 * 3. Portal manual review — optional second QA pass; when set, overrides field-test verdict for Results stats only.
 *
 * Confusion matrix / accuracy: predicted = `ml_raw_prediction`; expected (GT) follows reviewer verdict —
 * Incorrect → `user_correction` (reviewer truth) first; Correct → accepted read (`final_reading` / `ml_raw`).
 */
import { normalizeFieldTestCaptureTrigger } from './fieldTestCaptureTrigger.js';
import {
  fieldTestStatsCaptureCorrect,
  fieldTestStatsCaptureIncorrect,
} from './portalManualReview.js';

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

function pickGroundTruthReading(candidates) {
  const picked = candidates.find((v) => v != null && String(v).trim() !== '');
  const raw = String(picked ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

/**
 * Ground-truth reading for field-test per-dial expected digits (reviewer truth, not model output).
 * - Dial corrections flagged → user correction chain.
 * - Reviewer marked incorrect → GT is reviewer truth (`user_correction` before `final_reading` / ML).
 * - Reviewer marked correct, no dial flags → prefer ml_raw over stale user_correction (Dynamo gap).
 */
export function finalReadingFromMetadata(metadata) {
  const hadDialCorrections = countReadsCorrectedFromItem(metadata) > 0;
  const feedback = String(metadata?.feedback_type ?? '').trim().toLowerCase();
  const portalReviewWrong = metadata?.portal_manual_review_status === 'incorrect';
  const reviewerWrong =
    metadata?.is_correct === false || feedback === 'incorrect' || portalReviewWrong;
  const reviewerRight = metadata?.is_correct === true || feedback === 'correct';
  const portalDialEdit =
    Boolean(String(metadata?.portal_metadata_updated_by ?? '').trim()) &&
    countFieldTestDialReadingChanges(
      pickGroundTruthReading([metadata?.user_correction]),
      mlBaselineReadingFromMetadata(metadata),
    ) > 0;

  if (hadDialCorrections || reviewerWrong || portalDialEdit) {
    return pickGroundTruthReading([
      metadata?.user_correction,
      metadata?.final_reading,
      metadata?.ml_raw_prediction,
      metadata?.ml_prediction,
    ]);
  }

  if (reviewerRight) {
    return pickGroundTruthReading([
      metadata?.final_reading,
      metadata?.ml_raw_prediction,
      metadata?.user_correction,
      metadata?.ml_prediction,
    ]);
  }

  return pickGroundTruthReading([
    metadata?.final_reading,
    metadata?.ml_raw_prediction,
    metadata?.user_correction,
    metadata?.ml_prediction,
  ]);
}

/** True when every dial with ground truth matches the model (per-dial `match` flags). */
export function captureModelMatchesGroundTruth(perDial) {
  if (!Array.isArray(perDial) || perDial.length === 0) return false;
  let any = false;
  for (const row of perDial) {
    if (row?.expected == null) continue;
    any = true;
    if (row.match !== true) return false;
  }
  return any;
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

/** Device flags first; otherwise infer dial edits from portal `user_correction` vs model baseline. */
export function inferReadsCorrectedFromMetadata(metadata) {
  const incorrect = incorrectDialNumbersFromItem(metadata);
  if (incorrect.length > 0) return incorrect.length;

  const correctedPos = Array.isArray(metadata?.user_corrected_positions)
    ? metadata.user_corrected_positions.filter((n) => Number.isInteger(n))
    : [];
  if (correctedPos.length > 0) return correctedPos.length;

  if (!metadata?.portal_metadata_updated_by) {
    const stored = Number(metadata?.reads_corrected_count);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  const model = mlBaselineReadingFromMetadata(metadata);
  const user = pickGroundTruthReading([metadata?.user_correction]);
  if (!user || !model) return 0;
  return countFieldTestDialReadingChanges(user, model);
}

/** True when the on-device model needed no dial corrections (field-test ground truth). */
export function captureModelReadingCorrect(item) {
  return countReadsCorrectedFromItem(item) === 0;
}

/**
 * Same rules as Field test Images → “Reviewed incorrect” cohort.
 * Do not use `is_correct === false` alone — Dynamo stores false when the flag is unset.
 */
export function isFieldTestReviewedIncorrect(item) {
  if (!item) return false;
  const feedback = String(item.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'incorrect') return true;
  const status = String(item.folder_status ?? '').trim().toLowerCase();
  return (
    status === 'incorrect_analyzed' ||
    status === 'incorrect_labeled' ||
    status === 'incorrect_training' ||
    (status === 'incorrect_new' && item.is_manually_reviewed === true)
  );
}

/** Same rules as Field test Images → “Reviewed correct” cohort. */
export function isFieldTestReviewedCorrect(item) {
  if (!item) return false;
  const status = String(item.folder_status ?? '').trim().toLowerCase();
  if (status === 'correct') return true;
  const feedback = String(item.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'correct') return true;
  return item.is_correct === true;
}

/**
 * Reviewer marked capture incorrect (field-test Results).
 * Alias for {@link isFieldTestReviewedIncorrect} — matches Images tab counts.
 */
export function captureMarkedIncorrectByReviewer(item) {
  return isFieldTestReviewedIncorrect(item);
}

/** Reviewer verdict: capture passed portal Correct check (field-test read accuracy). */
export function captureCorrectByReviewer(item) {
  return isFieldTestReviewedCorrect(item);
}

/**
 * Reviewer moved the session to No dials / Not sure (S3 folder or metadata feedback).
 * These captures are excluded from field-test Images and Results even when `field_test_capture` is set.
 */
export function isFieldTestExcludedOutcome(item) {
  const feedback = String(item?.feedback_type ?? '').trim().toLowerCase();
  if (feedback === 'no_dials' || feedback === 'not_sure') return true;

  const status = String(item?.folder_status ?? '').trim().toLowerCase();
  if (status === 'no_dials' || status === 'not_sure') return true;

  return false;
}

/**
 * Include in field-test Results metrics only when the reviewer chose Correct or Incorrect.
 * Excludes No dials detected, Not sure, and other non-verdict outcomes.
 */
export function isFieldTestScorableCapture(item) {
  if (!item) return false;
  if (isFieldTestExcludedOutcome(item)) return false;
  return isFieldTestReviewedCorrect(item) || isFieldTestReviewedIncorrect(item);
}

/** Field upload rows shown on Field test Images / list (same exclusion as scorable). */
export function isFieldTestPortalCapture(item) {
  if (!item) return false;
  if (isFieldTestExcludedOutcome(item)) return false;

  if (item.field_test_capture === true) return true;

  return (
    String(item.upload_mode || '').trim().toLowerCase() === 'field' &&
    String(item.source_type || '').trim().toLowerCase() === 'field'
  );
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

  if (readsCorrected === 0 && metadata?.portal_metadata_updated_by) {
    const model = mlBaselineReadingFromMetadata(metadata);
    const user = pickGroundTruthReading([metadata?.user_correction]);
    if (user && model) {
      readsCorrected = countFieldTestDialReadingChanges(user, model);
    }
  }

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
      (metadata?.is_manually_reviewed === true || metadata?.is_human_reviewed === true) &&
      !isFieldTestExcludedOutcome({
        feedback_type: metadata?.feedback_type,
        folder_status: metadata?.folder_status,
      }),
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
          ml_raw_prediction: item.ml_raw_prediction,
          user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
          user_corrected_positions: item.user_corrected_positions,
          reads_corrected_count: item.reads_corrected_count,
          is_correct: item.is_correct,
          feedback_type: item.feedback_type,
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
  const groundMeta = {
    final_reading: item.final_reading,
    user_correction: item.user_correction,
    ml_prediction: item.ml_prediction,
    ml_raw_prediction: item.ml_raw_prediction,
    user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
    user_corrected_positions: item.user_corrected_positions,
    reads_corrected_count: item.reads_corrected_count,
    is_correct: item.is_correct,
    feedback_type: item.feedback_type,
  };
  const finalReading = finalReadingFromMetadata(groundMeta);
  let perDial = [];
  if (Array.isArray(item.dial_details) && item.dial_details.length > 0) {
    try {
      perDial = JSON.parse(
        deriveFieldTestFromMetadata({
          dial_details: item.dial_details,
          ...groundMeta,
        }).per_dial_compact,
      );
    } catch {
      perDial = [];
    }
  }
  if (!perDial.length) {
    perDial = perDialFromItem(item);
  }

  const modelOverallMatch = finalReading
    ? String(captureModelMatchesGroundTruth(perDial))
    : '';
  const reviewerCorrect = captureCorrectByReviewer(item);
  const statsCorrect = fieldTestStatsCaptureCorrect(item);
  const statsIncorrect = fieldTestStatsCaptureIncorrect(item);
  const overallMatch = statsCorrect ? 'true' : 'false';
  const predicted = mlBaselineReadingFromMetadata(item);
  const incorrectDials = incorrectDialNumbersFromItem(item);

  const row = {
    s3_key: item.primary_image_key || `${item.s3_session_prefix || ''}original.jpg`,
    filename: (item.primary_image_key || 'original.jpg').split('/').pop() || 'original.jpg',
    session_id: item.session_id,
    image_difficulty_code: code,
    image_difficulty: difficulty,
    predicted_reading: predicted,
    expected_reading_from_filename: finalReading,
    overall_reading_match: overallMatch,
    model_overall_reading_match: modelOverallMatch,
    reviewer_capture_correct: statsCorrect ? 'true' : 'false',
    reviewer_marked_incorrect: statsIncorrect ? 'true' : 'false',
    field_test_review_correct: reviewerCorrect ? 'true' : 'false',
    portal_manual_review_status:
      item.portal_manual_review_status === 'correct' || item.portal_manual_review_status === 'incorrect'
        ? item.portal_manual_review_status
        : '',
    is_manually_reviewed: item.is_manually_reviewed === true ? 'true' : 'false',
    captured_by: item.user_name || '',
    captured_at: item.captured_at || '',
    average_confidence: item.confidence != null ? String(item.confidence) : '',
    dial_count: String(item.dial_count ?? perDial.length ?? 4),
    reads_corrected_count: String(countReadsCorrectedFromItem(item)),
    incorrect_dial_numbers: incorrectDialNumbersFromItem(item).join(','),
    ml_raw_prediction: item.ml_raw_prediction || predicted,
    user_correction: item.user_correction || '',
    final_reading: finalReading,
    feedback_type: item.feedback_type || '',
    folder_status: item.folder_status || '',
    is_correct:
      item.is_correct === true ? 'true' : item.is_correct === false ? 'false' : '',
    portal_metadata_updated_by: item.portal_metadata_updated_by || '',
    portal_metadata_updated_at: item.portal_metadata_updated_at || '',
  };

  const correction = fieldTestReviewerCorrectionMeta({
    hadUserCorrection: countReadsCorrectedFromItem(item) > 0,
    portalMetadataUpdatedBy: item.portal_metadata_updated_by,
    portalMetadataUpdatedAt: item.portal_metadata_updated_at,
    expectedValue: item.user_correction,
    rawPrediction: item.ml_raw_prediction,
    meterValue: item.ml_prediction,
    feedbackType: item.feedback_type,
    isCorrect: item.is_correct,
    finalReading,
    readsCorrectedCount: countReadsCorrectedFromItem(item),
  });
  row.is_corrected = correction.isCorrected ? 'true' : 'false';
  row.dials_changed_count = String(correction.dialsChangedCount);
  row.corrected_by = correction.correctedBy || '';
  row.corrected_at = correction.correctedAt || '';
  row.corrected_on_device = correction.correctedOnDevice ? 'true' : 'false';

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
    if (incorrectDials.includes(d)) {
      row[`dial${d}_digit_match`] = 'false';
    } else if (pd.predicted != null && pd.expected != null) {
      row[`dial${d}_digit_match`] = pd.predicted === pd.expected ? 'true' : 'false';
    } else {
      row[`dial${d}_digit_match`] = pd.match != null ? (pd.match ? 'true' : 'false') : '';
    }
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

function pad4Reading(value) {
  const raw = String(value ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return raw.padStart(4, '0').slice(-4);
}

/** Count dial positions where ground truth ≠ on-device model (`ml_raw`). */
export function countFieldTestDialReadingChanges(groundTruth, modelReading) {
  const gt = pad4Reading(groundTruth);
  const model = pad4Reading(modelReading);
  if (!gt || !model) return 0;
  let changed = 0;
  for (let i = 0; i < 4; i++) {
    if (gt[i] !== model[i]) changed += 1;
  }
  return changed;
}

/** Corrected only when ≥1 dial digit changed vs model, or device flagged dial edits. */
export function fieldTestReviewerCorrectionMeta(reading) {
  const correctedBy = String(reading.portalMetadataUpdatedBy ?? '').trim() || null;
  const correctedAt = String(reading.portalMetadataUpdatedAt ?? '').trim() || null;
  const groundTruth = finalReadingFromMetadata({
    final_reading: reading.finalReading,
    user_correction: reading.expectedValue,
    ml_prediction: reading.meterValue,
    ml_raw_prediction: reading.rawPrediction,
    feedback_type: reading.feedbackType,
    is_correct: reading.isCorrect,
    reads_corrected_count: reading.readsCorrectedCount,
    portal_manual_review_status: reading.portalManualReviewStatus,
    portal_metadata_updated_by: reading.portalMetadataUpdatedBy,
  });
  const modelReading = mlBaselineReadingFromMetadata({
    ml_raw_prediction: reading.rawPrediction,
    ml_prediction: reading.meterValue,
  });
  const userCorrection = pad4Reading(reading.expectedValue);
  const portalDialChanges =
    userCorrection && modelReading ? countFieldTestDialReadingChanges(userCorrection, modelReading) : 0;
  const dialsChangedCount = Math.max(
    countFieldTestDialReadingChanges(groundTruth, modelReading),
    correctedBy ? portalDialChanges : 0,
  );
  const readsCorrectedStored =
    typeof reading.readsCorrectedCount === 'number' && reading.readsCorrectedCount > 0;
  const deviceCorrected = reading.hadUserCorrection === true || readsCorrectedStored;
  const isCorrected = deviceCorrected || dialsChangedCount > 0;
  const portalAttributed = Boolean(isCorrected && correctedBy);

  return {
    isCorrected,
    dialsChangedCount,
    correctedBy: portalAttributed ? correctedBy : null,
    correctedAt: portalAttributed && correctedAt ? correctedAt : null,
    correctedOnDevice: isCorrected && deviceCorrected && !portalAttributed,
  };
}

export function fieldTestCaptureToListItem(reading) {
  const difficulty = normalizeDifficulty(reading.imageDifficulty);
  const correction = fieldTestReviewerCorrectionMeta(reading);
  const finalReading = finalReadingFromMetadata({
    final_reading: reading.finalReading,
    user_correction: reading.expectedValue,
    ml_prediction: reading.meterValue,
    ml_raw_prediction: reading.rawPrediction,
    feedback_type: reading.feedbackType,
    is_correct: reading.isCorrect,
    reads_corrected_count: reading.readsCorrectedCount,
  });
  const predictedReading = mlBaselineReadingFromMetadata({
    ml_raw_prediction: reading.rawPrediction,
    ml_prediction: reading.meterValue,
  });
  return {
    sessionId: reading.id,
    s3SessionPrefix: reading.s3SessionPrefix,
    s3Bucket: reading.bucket,
    primaryImageKey: reading.primaryImageKey,
    capturedAt: reading.dateOfReading,
    capturedBy: reading.userName || '',
    finalReading: finalReading || null,
    predictedReading: predictedReading || null,
    imageDifficulty: difficulty,
    onTickDialCount: reading.onTickDialCount ?? null,
    readsCorrectedCount: reading.readsCorrectedCount ?? 0,
    hadUserCorrection: correction.isCorrected,
    correctedBy: correction.correctedBy,
    correctedAt: correction.correctedAt,
    correctedOnDevice: correction.correctedOnDevice,
    dialCount: reading.dialCount ?? 4,
    confidence: reading.confidence ?? null,
    appVersion: reading.appVersion || null,
    captureTrigger: normalizeFieldTestCaptureTrigger(reading) || null,
    imageSource: reading.imageSource || null,
  };
}
