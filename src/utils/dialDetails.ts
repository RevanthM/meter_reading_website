import type { MeterImage } from '../types';
import type { DialDetailFromMetadata, S3MeterReading } from '../services/api';

export function concatDialDigitsFromRows(rows: { dial: number; prediction: number }[]): string {
  if (!rows.length) return '';
  return [...rows]
    .sort((a, b) => a.dial - b.dial)
    .map((r) => {
      const n = Math.round(Number(r.prediction));
      if (!Number.isFinite(n)) return '0';
      return String(((n % 10) + 10) % 10);
    })
    .join('');
}

function meterDigitsOnly(meterValue: string | number | null | undefined): string {
  return String(meterValue ?? '').replace(/\D/g, '');
}

/** Best per-dial digit: flat `prediction`, then stage_3.digit, then `ml_prediction` at dial index. */
export function normalizeDialRowPrediction(
  row: DialDetailFromMetadata,
  meterValue?: string | number | null,
): number {
  const mv = meterDigitsOnly(meterValue);
  const dialNum = Number.isInteger(row.dial) && row.dial >= 1 ? row.dial : 1;
  const idx = dialNum - 1;

  let p = Number(row.prediction);
  if (!Number.isFinite(p) || p < 0 || p > 9) {
    const stageDigit = row.stage_3?.digit;
    if (stageDigit != null && Number.isFinite(Number(stageDigit))) {
      p = Number(stageDigit);
    }
  }
  if (Number.isFinite(p)) {
    const n = Math.round(p);
    if (n >= 0 && n <= 9) return ((n % 10) + 10) % 10;
  }
  const ch = mv[idx];
  if (ch !== undefined && /\d/.test(ch)) return parseInt(ch, 10);
  return 0;
}

export function isDialCropImage(img: MeterImage): boolean {
  return img.fileName?.startsWith('dial_') ?? false;
}

/** Infer dial rows from crop filenames when metadata has no `dial_details`. */
export function dialRowsFromDialCropImages(
  images: MeterImage[],
  meterValue: string | number | null | undefined,
): DialDetailFromMetadata[] {
  const sorted = images
    .filter(isDialCropImage)
    .sort((a, b) => (a.metadata.dialIndex ?? 0) - (b.metadata.dialIndex ?? 0));
  const mv = meterDigitsOnly(meterValue);
  return sorted.map((img) => {
    const pos = img.metadata.dialIndex ?? 0;
    const ch = mv[pos];
    let prediction = 0;
    if (ch !== undefined && /\d/.test(ch)) prediction = parseInt(ch, 10);
    return {
      dial: pos + 1,
      prediction,
      direction: 'clockwise',
      confidence: 0,
    };
  });
}

/** Prefer `dial_details` when consistent with `ml_prediction`; otherwise digits from whole-meter reading. */
export function reconcileDialRowsForReading(
  reading: Pick<S3MeterReading, 'dialDetails' | 'images' | 'meterValue' | 'expectedValue'>,
): DialDetailFromMetadata[] {
  const mv = meterDigitsOnly(reading.meterValue);
  const exp = meterDigitsOnly(reading.expectedValue);
  if (!reading.dialDetails?.length) {
    return dialRowsFromDialCropImages(reading.images, reading.meterValue);
  }

  const normalized = reading.dialDetails.map((d) => ({
    ...d,
    prediction: normalizeDialRowPrediction(d, reading.meterValue),
  }));

  const fromRows = meterDigitsOnly(concatDialDigitsFromRows(normalized));
  if (!mv || fromRows === mv) return normalized;
  /** Reviewer dial edits: keep `dial_details` when they match stored ground truth. */
  if (exp && fromRows === exp) return normalized;

  const fromCrops = dialRowsFromDialCropImages(reading.images, reading.meterValue);
  if (fromCrops.length > 0 && meterDigitsOnly(concatDialDigitsFromRows(fromCrops)) === mv) {
    return fromCrops;
  }

  return normalized.map((row) => {
    const dialNum = Number.isInteger(row.dial) && row.dial >= 1 ? row.dial : 1;
    const ch = mv[dialNum - 1];
    if (ch !== undefined && /\d/.test(ch)) {
      return { ...row, prediction: parseInt(ch, 10) };
    }
    return row;
  });
}

/** Per-dial digits from on-device model read only (never reviewer `user_correction`). */
export function reconcileModelDialRowsForReading(
  reading: Pick<S3MeterReading, 'dialDetails' | 'images' | 'meterValue' | 'rawPrediction'>,
): DialDetailFromMetadata[] {
  const raw = reading.rawPrediction;
  const ml =
    raw != null && String(raw).trim() !== ''
      ? meterDigitsOnly(raw)
      : meterDigitsOnly(reading.meterValue);
  return reconcileDialRowsForReading({
    ...reading,
    meterValue: ml || reading.meterValue,
    expectedValue: '',
  });
}
