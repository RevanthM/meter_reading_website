/**
 * Parse iOS unit-test export CSVs from S3 (`{workType}/unit_test_results/*.csv`).
 * Format matches AnalogMeterReader UnitTestPerImageCsv.swift.
 */

import { ListObjectsV2Command } from '@aws-sdk/client-s3';

/** @param {string} csvText */
export function parseUnitTestCsvSummary(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  const summary = {};
  let inSummary = false;
  let perImageHeader = null;
  const perImageRows = [];

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length >= 2 && cols[0] === 'section') {
      if (cols[1] === 'UNIT_TEST_RUN_SUMMARY') {
        inSummary = true;
        continue;
      }
      if (cols[1] === 'PER_IMAGE_PER_DIAL_ROWS') {
        inSummary = false;
        continue;
      }
    }

    if (inSummary && cols.length >= 2) {
      summary[cols[0]] = cols[1];
      continue;
    }

    if (!inSummary && !perImageHeader && cols[0] === 's3_key') {
      perImageHeader = cols;
      continue;
    }

    if (perImageHeader && cols.length >= perImageHeader.length) {
      const row = {};
      perImageHeader.forEach((h, i) => {
        row[h] = cols[i] ?? '';
      });
      perImageRows.push(row);
    }
  }

  const imagesProcessed = parseInt(summary.images_processed || '0', 10) || 0;
  const withGroundTruth = parseInt(summary.with_filename_ground_truth || '0', 10) || 0;
  const correct = parseInt(summary.correct_readings || '0', 10) || 0;
  const accuracyPercent =
    summary.accuracy_percent != null && summary.accuracy_percent !== ''
      ? parseFloat(summary.accuracy_percent)
      : withGroundTruth > 0
        ? (100 * correct) / withGroundTruth
        : null;

  return {
    summary: {
      ...summary,
      imagesProcessed,
      withGroundTruth,
      correct,
      accuracyPercent,
    },
    perImageRows,
    perImageCount: perImageRows.length,
  };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {string} prefix e.g. `1000/unit_test_results/`
 */
export async function listUnitTestResultCsvKeys(s3Client, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of out.Contents || []) {
      const key = obj.Key || '';
      if (key.endsWith('.csv') && !key.endsWith('/')) {
        keys.push({
          key,
          size: obj.Size || 0,
          lastModified: obj.LastModified?.toISOString?.() || null,
          fileName: key.split('/').pop(),
        });
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  keys.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
  return keys;
}
