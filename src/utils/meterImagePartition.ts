import type { MeterImage } from '../types';

function isDialCropImage(image: MeterImage): boolean {
  return image.fileName?.startsWith('dial_') ?? false;
}

function isFullMeterImage(image: MeterImage): boolean {
  const fn = (image.fileName || '').toLowerCase();
  if (fn.endsWith('original.jpg') || fn === 'original.jpg') return true;
  if (/full\s*meter/i.test(image.label)) return true;
  if (/^original/i.test(image.label.trim()) && !/dial/i.test(image.label)) return true;
  return false;
}

/** Primary full-meter image for thumbnails and lightbox. */
export function primaryMeterImage(images: MeterImage[] | undefined): MeterImage | undefined {
  if (!images?.length) return undefined;
  return images.find(isFullMeterImage) ?? images.find((img) => !isDialCropImage(img)) ?? images[0];
}

export function primaryMeterImageUrl(images: MeterImage[] | undefined): string | null {
  const img = primaryMeterImage(images);
  return img?.url?.trim() || null;
}
