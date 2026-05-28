/**
 * Derive field-test analytics fields from iOS metadata.json (no separate manifest).
 */

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

/** Per-capture dial corrections for rollups. */
export function countReadsCorrectedFromItem(item) {
  const stored = Number(item?.reads_corrected_count);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const incorrect = Array.isArray(item?.user_incorrect_dial_numbers)
    ? item.user_incorrect_dial_numbers.filter((n) => Number.isInteger(n))
    : [];
  if (incorrect.length > 0) return incorrect.length;

  const correctedPos = Array.isArray(item?.user_corrected_positions)
    ? item.user_corrected_positions.filter((n) => Number.isInteger(n))
    : [];
  if (correctedPos.length > 0) return correctedPos.length;

  if (Array.isArray(item?.dial_details)) {
    let fromFlags = 0;
    for (const d of item.dial_details) {
      if (d && d.user_dial_correct === false) fromFlags += 1;
    }
    if (fromFlags > 0) return fromFlags;
  }

  const ml = mlBaselineReadingFromMetadata(item);
  const final = finalReadingFromMetadata(item);
  if (ml.length === 4 && final.length === 4) {
    let diff = 0;
    for (let i = 0; i < 4; i++) {
      if (ml[i] !== final[i]) diff += 1;
    }
    if (diff > 0) return diff;
  }

  if (item?.had_user_correction === true || String(item?.feedback_type || '').toLowerCase() === 'incorrect') {
    return 1;
  }
  return 0;
}

function dialDigitMatches(expected, predicted, dialNumber) {
  if (expected !== predicted) {
    if (dialNumber === 4 && predicted === (expected + 9) % 10) return true;
    return false;
  }
  return true;
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

  if (readsCorrected === 0) {
    for (const d of dialDetails) {
      if (d && d.user_dial_correct === false) readsCorrected += 1;
    }
  }

  if (readsCorrected === 0 && mlBaseline.length === 4 && finalReading.length === 4) {
    for (let i = 0; i < 4; i++) {
      if (mlBaseline[i] !== finalReading[i]) readsCorrected += 1;
    }
  }

  const feedbackType = String(metadata?.feedback_type || '').trim().toLowerCase();
  const manuallyReviewed =
    metadata?.is_manually_reviewed === true || metadata?.is_human_reviewed === true;

  const hadUserCorrection =
    readsCorrected > 0 ||
    (manuallyReviewed && feedbackType && feedbackType !== 'correct') ||
    Boolean(
      metadata?.user_correction &&
        String(metadata.user_correction).replace(/\D/g, '') !==
          String(metadata?.ml_prediction ?? '').replace(/\D/g, ''),
    );

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
  const predicted = mlBaselineReadingFromMetadata(item);

  let perDial = [];
  try {
    perDial = item.per_dial_compact ? JSON.parse(String(item.per_dial_compact)) : [];
  } catch {
    perDial = [];
  }

  const overallMatch =
    finalReading && predicted
      ? String(finalReading === predicted)
      : '';

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
  };
}
