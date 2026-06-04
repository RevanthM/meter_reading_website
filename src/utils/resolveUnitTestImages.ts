import {
  fetchUnitTestImages,
  unitTestImageDownloadUrl,
  type UnitTestImageRow,
  type UnitTestManifestRow,
} from '../services/api';
import type { WorkType } from '../types';
import { perImageRowFileName } from './unitTestCsvAnalytics';
import {
  buildUnitTestImageFileName,
  normalizeUnitTestDifficulty,
  parseUnitTestImageFileName,
} from './unitTestImageNaming';

function readingDigits(raw: string): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .trim();
}

/** Manifest row for a metrics CSV row: match by filename, else build from expected then predicted. */
export function manifestRowForUnitTestCsvRow(
  byFile: Map<string, UnitTestManifestRow>,
  row: Record<string, string>,
): { fileName: string; manifest: UnitTestManifestRow } | null {
  const csvName = perImageRowFileName(row);
  if (!csvName) return null;

  const direct = byFile.get(csvName);
  if (direct) return { fileName: csvName, manifest: direct };

  const parsed = parseUnitTestImageFileName(csvName);
  if (!parsed) return null;

  const difficulty = normalizeUnitTestDifficulty(row.image_difficulty || parsed.difficulty);
  const ext = csvName.split('.').pop() || 'jpeg';
  const expected = readingDigits(row.expected_reading_from_filename);
  const predicted = readingDigits(row.predicted_reading);

  for (const reading of [expected, predicted]) {
    if (!reading) continue;
    const fileName = buildUnitTestImageFileName(parsed.prefix, reading, difficulty, ext);
    const manifest = byFile.get(fileName);
    if (manifest) return { fileName, manifest };
  }

  return null;
}

/** Resolve unit-test images from metrics CSV rows (manifest + expected/predicted filenames). */
export async function resolveUnitTestImagesFromRows(
  rows: Record<string, string>[],
  workType: WorkType,
): Promise<{ images: UnitTestImageRow[]; missing: string[] }> {
  const { manifestRows = [] } = await fetchUnitTestImages(workType);
  const byFile = new Map<string, UnitTestManifestRow>();
  for (const r of manifestRows) {
    if (r.image_file_name) byFile.set(r.image_file_name, r);
  }

  const seen = new Set<string>();
  const images: UnitTestImageRow[] = [];
  const missing: string[] = [];

  for (const row of rows) {
    const csvName = perImageRowFileName(row);
    if (!csvName || seen.has(csvName)) continue;
    seen.add(csvName);

    const hit = manifestRowForUnitTestCsvRow(byFile, row);
    if (!hit) {
      missing.push(csvName);
      continue;
    }

    const s3Key = hit.manifest.s3_key || `${workType}/unit_test_images/${hit.fileName}`;
    const groundTruth = (row.expected_reading_from_filename || '').trim();
    const predicted = (row.predicted_reading || '').trim();
    images.push({
      s3Key,
      fileName: hit.fileName,
      expectedMeterValue:
        hit.manifest.expected_meter_value ||
        readingDigits(groundTruth) ||
        null,
      imageDifficulty: normalizeUnitTestDifficulty(
        hit.manifest.image_difficulty || row.image_difficulty,
      ),
      groundTruthReading: groundTruth || null,
      predictedReading: predicted || null,
      url: unitTestImageDownloadUrl(workType, s3Key),
    });
  }

  return { images, missing };
}
