import type { MeterImage } from '../types';

function isDialCropImage(image: MeterImage): boolean {
  return image.fileName?.startsWith('dial_') ?? false;
}

function isGuidedCropImage(image: MeterImage): boolean {
  if (isDialCropImage(image)) return false;
  const fn = (image.fileName || '').toLowerCase();
  if (fn === 'original.jpg') return true;
  if (/guided/i.test(image.label)) return true;
  return false;
}

function isFullMeterFrameImage(image: MeterImage): boolean {
  if (isDialCropImage(image)) return false;
  const fn = (image.fileName || '').toLowerCase();
  if (fn === 'full_meter.jpg') return true;
  if (/full\s*meter/i.test(image.label) && !/guided/i.test(image.label)) return true;
  return false;
}

export function partitionMeterImages(images: MeterImage[] | undefined): {
  guidedCrop: MeterImage | undefined;
  fullMeter: MeterImage | undefined;
  dialImages: MeterImage[];
  otherImages: MeterImage[];
} {
  if (!images?.length) {
    return { guidedCrop: undefined, fullMeter: undefined, dialImages: [], otherImages: [] };
  }

  const dialImages = images
    .filter(isDialCropImage)
    .sort((a, b) => {
      const aIx = parseInt(a.fileName?.match(/dial_(\d+)/)?.[1] || '0', 10);
      const bIx = parseInt(b.fileName?.match(/dial_(\d+)/)?.[1] || '0', 10);
      return aIx - bIx;
    });

  const guidedCrop = images.find(isGuidedCropImage);
  const fullMeter = images.find(isFullMeterFrameImage);

  const claimed = new Set<string>([
    ...(guidedCrop ? [guidedCrop.id] : []),
    ...(fullMeter ? [fullMeter.id] : []),
    ...dialImages.map((d) => d.id),
  ]);
  const otherImages = images.filter((img) => !claimed.has(img.id));

  return { guidedCrop, fullMeter, dialImages, otherImages };
}

/** Primary thumbnail: guided crop (detection frame), then full frame, then first non-dial. */
export function primaryMeterImage(images: MeterImage[] | undefined): MeterImage | undefined {
  const { guidedCrop, fullMeter, dialImages, otherImages } = partitionMeterImages(images);
  return guidedCrop ?? fullMeter ?? otherImages[0] ?? dialImages[0];
}

export function primaryMeterImageUrl(images: MeterImage[] | undefined): string | null {
  const img = primaryMeterImage(images);
  return img?.url?.trim() || null;
}
