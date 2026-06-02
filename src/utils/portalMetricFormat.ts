/** Decimal places for accuracy and confidence % across the portal UI. */
export const PORTAL_ACCURACY_CONFIDENCE_PCT_DECIMALS = 3;

const PCT_FACTOR = 10 ** PORTAL_ACCURACY_CONFIDENCE_PCT_DECIMALS;

/** Round a 0–100 accuracy or confidence percentage for storage/compute. */
export function roundPortalAccuracyConfidencePct(value: number): number {
  return Math.round(value * PCT_FACTOR) / PCT_FACTOR;
}

/** Parse raw confidence (0–1 or 0–100) to 0–100 % without rounding. */
export function confidencePctFromRaw(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (n <= 1 && n >= 0) return n * 100;
  return n;
}

/** Parse and round confidence for display/storage. */
export function normalizeConfidencePct(raw: string | number | null | undefined): number | null {
  const pct = confidencePctFromRaw(raw);
  if (pct == null) return null;
  return roundPortalAccuracyConfidencePct(pct);
}

/** Format a 0–100 accuracy or confidence percentage for display. */
export function formatPortalAccuracyConfidencePct(
  value: number | null | undefined,
  empty = '—',
): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return `${value.toFixed(PORTAL_ACCURACY_CONFIDENCE_PCT_DECIMALS)}%`;
}

/** Format a 0–1 fraction as a 0–100% accuracy/confidence value. */
export function formatPortalAccuracyConfidencePctFromFraction(
  value: number | null | undefined,
  empty = '—',
): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return formatPortalAccuracyConfidencePct(value * 100, empty);
}
