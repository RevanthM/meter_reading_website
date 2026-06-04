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
  /** Reviewer per-dial GT saved in dial_details — do not replace with ml_prediction. */
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
