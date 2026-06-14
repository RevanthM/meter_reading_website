/** Metadata normalization helpers (mirrors server/index.js). */

export function normalizeSessionConfidenceValue(raw) {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  if (n > 1 && n <= 100) return n / 100;
  if (n >= 0 && n <= 1) return n;
  return undefined;
}

export function normalizeDialDetailsFromMetadata(dialDetails, mlPrediction, userCorrection) {
  if (!Array.isArray(dialDetails) || dialDetails.length === 0) return dialDetails;
  const mv = String(mlPrediction ?? '').replace(/\D/g, '');
  const exp = String(userCorrection ?? '').replace(/\D/g, '');

  const normalized = dialDetails.map((d, i) => {
    if (!d || typeof d !== 'object') return d;
    const c = normalizeSessionConfidenceValue(d.confidence);
    const dialNum = Number.isInteger(d.dial) && d.dial >= 1 ? d.dial : i + 1;
    let prediction = d.prediction;
    if (!Number.isFinite(Number(prediction)) || prediction < 0 || prediction > 9) {
      const stageDigit = d.stage_3?.digit;
      if (stageDigit != null && Number.isFinite(Number(stageDigit))) prediction = Number(stageDigit);
    }
    let digit = Number.isFinite(Number(prediction)) ? Math.round(Number(prediction)) : 0;
    digit = ((digit % 10) + 10) % 10;
    return {
      ...d,
      dial: dialNum,
      prediction: digit,
      ...(c !== undefined ? { confidence: c } : {}),
    };
  });

  if (!mv && !exp) return normalized;

  const fromRows = [...normalized]
    .sort((a, b) => a.dial - b.dial)
    .map((r) => String(r.prediction))
    .join('');
  if (exp && fromRows === exp) return normalized;
  if (mv && fromRows === mv) return normalized;

  const alignTo = mv || exp;
  if (!alignTo) return normalized;

  return normalized.map((row, i) => {
    const dialNum = row.dial >= 1 ? row.dial : i + 1;
    const ch = alignTo[dialNum - 1];
    if (ch && /\d/.test(ch)) {
      return { ...row, prediction: parseInt(ch, 10) };
    }
    return row;
  });
}

export function normalizeCaptureLocation(metadata) {
  const loc = metadata?.capture_location;
  if (!loc || typeof loc !== 'object') return null;
  const latitude = typeof loc.latitude === 'number' && Number.isFinite(loc.latitude) ? loc.latitude : null;
  const longitude = typeof loc.longitude === 'number' && Number.isFinite(loc.longitude) ? loc.longitude : null;
  const placeLabel = typeof loc.place_label === 'string' ? loc.place_label.trim() || null : null;
  const coordinateLabel =
    typeof loc.coordinate_label === 'string' ? loc.coordinate_label.trim() || null : null;
  const accuracyM =
    typeof loc.accuracy_m === 'number' && Number.isFinite(loc.accuracy_m) ? loc.accuracy_m : null;
  const capturedAt = typeof loc.captured_at === 'string' ? loc.captured_at.trim() || null : null;
  if (!placeLabel && !coordinateLabel && latitude == null && longitude == null) return null;
  return { placeLabel, coordinateLabel, latitude, longitude, accuracyM, capturedAt };
}

export function formatCaptureLocationFromMetadata(metadata) {
  const loc = normalizeCaptureLocation(metadata);
  if (!loc) return null;
  if (loc.placeLabel) return loc.placeLabel;
  if (loc.coordinateLabel) return loc.coordinateLabel;
  if (loc.latitude != null && loc.longitude != null) {
    const latH = loc.latitude >= 0 ? 'N' : 'S';
    const lonH = loc.longitude >= 0 ? 'E' : 'W';
    return `${Math.abs(loc.latitude).toFixed(5)}° ${latH}, ${Math.abs(loc.longitude).toFixed(5)}° ${lonH}`;
  }
  return null;
}

/** Gyro snapshot at in-app camera shutter (`metadata.capture_device_tilt`). */
export function normalizeCaptureDeviceTilt(metadata) {
  const tilt = metadata?.capture_device_tilt;
  if (!tilt || typeof tilt !== 'object') return null;
  const rollDeg = typeof tilt.roll_deg === 'number' && Number.isFinite(tilt.roll_deg) ? tilt.roll_deg : null;
  const pitchDeg = typeof tilt.pitch_deg === 'number' && Number.isFinite(tilt.pitch_deg) ? tilt.pitch_deg : null;
  const levelDotOffsetXNorm =
    typeof tilt.level_dot_offset_x_norm === 'number' && Number.isFinite(tilt.level_dot_offset_x_norm)
      ? tilt.level_dot_offset_x_norm
      : null;
  const levelDotOffsetYNorm =
    typeof tilt.level_dot_offset_y_norm === 'number' && Number.isFinite(tilt.level_dot_offset_y_norm)
      ? tilt.level_dot_offset_y_norm
      : null;
  const isLevel = tilt.is_level === true ? true : tilt.is_level === false ? false : null;
  const capturedAt = typeof tilt.captured_at === 'string' ? tilt.captured_at.trim() || null : null;
  if (rollDeg == null && pitchDeg == null && isLevel == null) return null;
  return { rollDeg, pitchDeg, levelDotOffsetXNorm, levelDotOffsetYNorm, isLevel, capturedAt };
}

/** Compass snapshot at shutter (`metadata.capture_compass`). */
export function normalizeCaptureCompass(metadata) {
  const compass = metadata?.capture_compass;
  if (!compass || typeof compass !== 'object') return null;
  const cameraHeadingDeg =
    typeof compass.camera_heading_deg === 'number' && Number.isFinite(compass.camera_heading_deg)
      ? compass.camera_heading_deg
      : null;
  const cameraFacing = typeof compass.camera_facing === 'string' ? compass.camera_facing.trim() || null : null;
  const meterFacingDeg =
    typeof compass.meter_facing_deg === 'number' && Number.isFinite(compass.meter_facing_deg)
      ? compass.meter_facing_deg
      : null;
  const meterFacing = typeof compass.meter_facing === 'string' ? compass.meter_facing.trim() || null : null;
  const headingAccuracyDeg =
    typeof compass.heading_accuracy_deg === 'number' && Number.isFinite(compass.heading_accuracy_deg)
      ? compass.heading_accuracy_deg
      : null;
  const capturedAt = typeof compass.captured_at === 'string' ? compass.captured_at.trim() || null : null;
  if (cameraHeadingDeg == null && !cameraFacing && meterFacingDeg == null && !meterFacing) return null;
  return { cameraHeadingDeg, cameraFacing, meterFacingDeg, meterFacing, headingAccuracyDeg, capturedAt };
}
