/** Decimal places for accuracy and confidence % (portal + server CSV apply). */
export const PORTAL_ACCURACY_CONFIDENCE_PCT_DECIMALS = 3;

const PCT_FACTOR = 10 ** PORTAL_ACCURACY_CONFIDENCE_PCT_DECIMALS;

/** Round a 0–100 accuracy or confidence percentage. */
export function roundPortalAccuracyConfidencePct(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * PCT_FACTOR) / PCT_FACTOR;
}

/** Parse raw confidence (0–1 or 0–100) to 0–100 % without rounding. */
export function confidencePctFromRaw(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (n <= 1 && n >= 0) return n * 100;
  return n;
}

/** Parse and round confidence for display/storage. */
export function normalizeConfidencePct(raw) {
  const pct = confidencePctFromRaw(raw);
  if (pct == null) return null;
  return roundPortalAccuracyConfidencePct(pct);
}
