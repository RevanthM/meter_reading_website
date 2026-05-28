/**
 * Parse iOS unit-test export CSVs from S3 (`{workType}/unit_test_results/*.csv`).
 * Format matches AnalogMeterReader UnitTestPerImageCsv.swift.
 */

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { normalizeConfidencePct } from './unitTestMetricsApply.js';

/** iOS export: d1/d2/d3 = normal / difficult / very_difficult (not meter dials). */
const IMAGE_DIFFICULTY_TIERS = [
  { code: 'd1', label: 'Normal' },
  { code: 'd2', label: 'Difficult' },
  { code: 'd3', label: 'Very difficult' },
];

/**
 * @param {Record<string, string>} raw keys like d1_image_count, d1_accuracy_percent
 */
function buildImageDifficultyBreakdown(raw) {
  return IMAGE_DIFFICULTY_TIERS.map(({ code, label }) => {
    const imageCount = parseInt(raw[`${code}_image_count`] || '0', 10) || 0;
    const withGroundTruth = parseInt(raw[`${code}_with_ground_truth`] || '0', 10) || 0;
    const correct = parseInt(raw[`${code}_correct`] || '0', 10) || 0;
    const accRaw = raw[`${code}_accuracy_percent`];
    let accuracyPct = null;
    if (accRaw != null && accRaw !== '') {
      const v = parseFloat(accRaw);
      if (Number.isFinite(v)) accuracyPct = Math.round(v * 10) / 10;
    } else if (withGroundTruth > 0) {
      accuracyPct = Math.round((1000 * correct) / withGroundTruth) / 10;
    }
    let confidencePct = null;
    const confRaw = raw[`${code}_average_confidence`];
    if (confRaw != null && confRaw !== '') {
      const n = parseFloat(confRaw);
      if (Number.isFinite(n)) {
        const pct = n <= 1 && n >= 0 ? n * 100 : n;
        confidencePct = Math.round(pct * 10) / 10;
      }
    }
    return { code, label, imageCount, withGroundTruth, correct, accuracyPct, confidencePct };
  });
}

/** @param {string} csvText */
export function parseUnitTestCsvSummary(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  const summary = {};
  const imageDifficulty = {};
  /** @type {'run' | 'per_dial' | 'image_difficulty' | null} */
  let summarySection = null;
  let perImageHeader = null;
  const perImageRows = [];

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length >= 2 && cols[0] === 'section') {
      if (cols[1] === 'UNIT_TEST_RUN_SUMMARY' || cols[1] === 'FIELD_CAPTURE_SUMMARY') {
        summarySection = 'run';
        continue;
      }
      if (cols[1] === 'PER_DIAL_BREAKDOWN') {
        summarySection = 'per_dial';
        continue;
      }
      if (cols[1] === 'IMAGE_DIFFICULTY_BREAKDOWN') {
        summarySection = 'image_difficulty';
        continue;
      }
      if (cols[1] === 'PER_IMAGE_PER_DIAL_ROWS') {
        summarySection = null;
        continue;
      }
      summarySection = null;
      continue;
    }

    if (summarySection === 'image_difficulty' && cols.length >= 2 && cols[0] !== '' && cols[0] !== 'section') {
      imageDifficulty[cols[0]] = cols[1];
      continue;
    }

    if (summarySection && summarySection !== 'image_difficulty' && cols.length >= 2 && cols[0] !== '' && cols[0] !== 'section') {
      summary[cols[0]] = cols[1];
      continue;
    }

    if (!summarySection && !perImageHeader && cols[0] === 's3_key') {
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

  if (!summary.images_processed && summary.overall_reading_match != null && summary.overall_reading_match !== '') {
    summary.images_processed = '1';
    const expected = String(summary.expected_reading || '').trim();
    if (expected) {
      summary.with_filename_ground_truth = '1';
      const match = String(summary.overall_reading_match).trim().toLowerCase();
      summary.correct_readings = match === 'true' || match === '1' ? '1' : '0';
    }
  }
  if (!summary.run_by && summary.captured_by) {
    summary.run_by = summary.captured_by;
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

  const imageDifficultyBreakdown =
    Object.keys(imageDifficulty).length > 0 ? buildImageDifficultyBreakdown(imageDifficulty) : [];

  return {
    summary: {
      ...summary,
      imagesProcessed,
      withGroundTruth,
      correct,
      accuracyPercent,
    },
    imageDifficultyBreakdown,
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

/** Parse iOS export stem: `results_<UTC>_<pipelineId>_<appVer>_export.csv` */
export function parseUnitTestFileName(fileName) {
  const base = String(fileName || '').replace(/\.csv$/i, '');
  const m = /^results_[^_]+_(.+)_export$/i.exec(base);
  if (!m) return { pipelineId: null, appVersionHint: null };
  const tail = m[1];
  const parts = tail.split('_');
  if (parts.length < 2) return { pipelineId: tail, appVersionHint: null };
  const appVersionHint = parts[parts.length - 1] ?? null;
  const pipelineId = parts.slice(0, -1).join('_');
  return { pipelineId: pipelineId || null, appVersionHint };
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {string} key
 */
export async function fetchUnitTestCsvSummaryHead(s3Client, bucket, key, streamToString) {
  const out = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: 'bytes=0-65535',
    }),
  );
  const partial = await streamToString(out.Body);
  const parsed = parseUnitTestCsvSummary(partial);
  return parsed.summary;
}

/**
 * @param {{ key: string, fileName: string, size: number, lastModified: string | null }} run
 * @param {Record<string, unknown>} summary
 */
export function buildUnitTestRunListItem(run, summary) {
  const fileName = run.fileName || run.key.split('/').pop() || run.key;
  const fromName = parseUnitTestFileName(fileName);
  const imagesProcessed =
    summary.imagesProcessed != null && Number.isFinite(summary.imagesProcessed)
      ? summary.imagesProcessed
      : null;
  const accuracyPercent =
    summary.accuracyPercent != null && Number.isFinite(summary.accuracyPercent)
      ? Math.round(summary.accuracyPercent * 10) / 10
      : null;
  const averageConfidencePct = normalizeConfidencePct(summary.average_confidence);
  const appVersion =
    (typeof summary.app_version === 'string' && summary.app_version.trim()) ||
    fromName.appVersionHint ||
    null;
  const runBy =
    (typeof summary.user_name === 'string' && summary.user_name.trim()) ||
    (typeof summary.run_by === 'string' && summary.run_by.trim()) ||
    (typeof summary.runner_name === 'string' && summary.runner_name.trim()) ||
    null;
  const pipelineDisplayName =
    (typeof summary.pipeline_display_name === 'string' && summary.pipeline_display_name.trim()) ||
    null;
  const pipelineId =
    (typeof summary.pipeline_id === 'string' && summary.pipeline_id.trim()) ||
    fromName.pipelineId ||
    null;
  const pipelineVersion =
    (typeof summary.pipeline_version === 'string' && summary.pipeline_version.trim()) || null;
  const generatedUtc =
    (typeof summary.generated_utc === 'string' && summary.generated_utc.trim()) ||
    run.lastModified ||
    null;

  return {
    key: run.key,
    fileName,
    size: run.size,
    lastModified: run.lastModified,
    generatedUtc,
    runBy,
    pipelineDisplayName,
    pipelineId,
    pipelineVersion,
    imagesProcessed,
    appVersion,
    accuracyPercent,
    averageConfidencePct,
  };
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {Array<{ key: string, fileName: string, size: number, lastModified: string | null }>} runs
 * @param {(body: unknown) => Promise<string>} streamToString
 */
export async function enrichUnitTestRunsWithSummary(s3Client, bucket, runs, streamToString, { limit } = {}) {
  const maxSummary = Math.max(0, limit ?? runs.length);
  const concurrency = Math.max(4, parseInt(process.env.UNIT_TEST_SUMMARY_CONCURRENCY || '12', 10) || 12);
  const out = [];
  for (let i = 0; i < runs.length; i += concurrency) {
    const chunk = runs.slice(i, i + concurrency);
    const batch = await Promise.all(
      chunk.map(async (run, offset) => {
        const index = i + offset;
        if (index >= maxSummary) {
          return buildUnitTestRunListItem(run, {});
        }
        try {
          const summary = await fetchUnitTestCsvSummaryHead(s3Client, bucket, run.key, streamToString);
          return buildUnitTestRunListItem(run, summary);
        } catch {
          return {
            ...buildUnitTestRunListItem(run, {}),
            summaryLoaded: false,
          };
        }
      }),
    );
    out.push(...batch);
  }
  return out;
}
