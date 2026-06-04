/**
 * Unit test image registry on S3 (`unittestng_manifest.json`).
 * Legacy `unittestng_manifest.xlsx` is read once and migrated to JSON on first access.
 * iOS unit tests list images by prefix and parse `{prefix}_d{1|2|3}_{reading}.ext` from the filename only.
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as XLSX from 'xlsx';

const MANIFEST_JSON_FILE = 'unittestng_manifest.json';
const MANIFEST_LEGACY_XLSX_FILE = 'unittestng_manifest.xlsx';

const MANIFEST_CACHE_TTL_MS = Math.max(
  0,
  parseInt(process.env.UNIT_TEST_MANIFEST_CACHE_TTL_MS || '10000', 10) || 0,
);
/** @type {Map<string, { timestamp: number, key: string, rows: ReturnType<typeof normalizeRow>[] }>} */
const manifestCache = new Map();

export function invalidateUnitTestManifestCache(workType) {
  manifestCache.delete(String(workType || '1000').trim() || '1000');
}

/** @typedef {'normal' | 'difficult' | 'very_difficult'} UnitTestImageDifficulty */

export const UNIT_TEST_DIFFICULTY_CODES = {
  normal: 'd1',
  difficult: 'd2',
  very_difficult: 'd3',
};

const CODE_TO_DIFFICULTY = {
  d1: 'normal',
  d2: 'difficult',
  d3: 'very_difficult',
};

export function unitTestImagesPrefix(workType) {
  const wt = String(workType || '1000').trim() || '1000';
  return `${wt}/unit_test_images/`;
}

export function unitTestManifestKey(workType) {
  const env = String(process.env.UNIT_TEST_MANIFEST_S3_KEY || '').trim();
  if (env) return env.replace('{workType}', String(workType || '1000'));
  return `${unitTestImagesPrefix(workType)}${MANIFEST_JSON_FILE}`;
}

export function unitTestManifestLegacyXlsxKey(workType) {
  return `${unitTestImagesPrefix(workType)}${MANIFEST_LEGACY_XLSX_FILE}`;
}

/** Skip registry objects when listing flat image keys in the folder. */
export function isUnitTestManifestObjectKey(fileName) {
  const lower = String(fileName || '').toLowerCase();
  return lower === MANIFEST_JSON_FILE || lower === MANIFEST_LEGACY_XLSX_FILE;
}

export function difficultyToCode(difficulty) {
  const d = String(difficulty || 'normal')
    .trim()
    .toLowerCase();
  if (d === 'difficult') return 'd2';
  if (d === 'very_difficult' || d === 'very difficult') return 'd3';
  return 'd1';
}

export function codeToDifficulty(code) {
  const c = String(code || 'd1').toLowerCase();
  return CODE_TO_DIFFICULTY[c] || 'normal';
}

export function normalizeUnitTestDifficulty(raw) {
  const d = String(raw || 'normal')
    .trim()
    .toLowerCase();
  if (d === 'difficult') return 'difficult';
  if (d === 'very_difficult' || d === 'very difficult') return 'very_difficult';
  return 'normal';
}

/**
 * Parse `{prefix}_{reading}.ext` (legacy) or `{prefix}_d{1|2|3}_{reading}.ext`.
 */
export function parseUnitTestImageFileName(fileName) {
  const base = String(fileName || '').split('/').pop() || '';
  const mNew = /^(\d+)_d([123])_(\d+)\./i.exec(base);
  if (mNew) {
    const difficultyCode = `d${mNew[2]}`;
    return {
      prefix: mNew[1],
      difficultyCode,
      difficulty: codeToDifficulty(difficultyCode),
      expected: mNew[3],
    };
  }
  const mOld = /^(\d+)_(\d+)\./i.exec(base);
  if (mOld) {
    return {
      prefix: mOld[1],
      difficultyCode: 'd1',
      difficulty: 'normal',
      expected: mOld[2],
    };
  }
  return null;
}

/** Build flat filename: `{prefix}_d{1|2|3}_{expectedReading}.ext` */
export function buildUnitTestImageFileName(filePrefix, expectedMeterValue, difficulty = 'normal', ext = 'jpeg') {
  const prefix = String(filePrefix ?? '').replace(/\D/g, '') || '1';
  const code = difficultyToCode(difficulty);
  const digits = String(expectedMeterValue ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
  const reading = digits || '0';
  const cleanExt = String(ext || 'jpeg').replace(/^\./, '').toLowerCase() || 'jpeg';
  return `${prefix}_${code}_${reading}.${cleanExt}`;
}

/** @deprecated use buildUnitTestImageFileName */
export function buildUnitTestImageFileNameKeepingPrefix(filePrefix, expectedMeterValue, ext = 'jpeg') {
  return buildUnitTestImageFileName(filePrefix, expectedMeterValue, 'normal', ext);
}

export function parseExpectedFromUnitTestFileName(fileName) {
  const parsed = parseUnitTestImageFileName(fileName);
  return parsed?.expected ?? null;
}

/** Legacy name without difficulty segment → new name with d1. */
export function migrateLegacyFileNameToWithDifficulty(fileName, difficulty = 'normal') {
  const parsed = parseUnitTestImageFileName(fileName);
  if (!parsed) return null;
  if (/^(\d+)_d[123]_(\d+)\./i.test(String(fileName).split('/').pop() || '')) {
    return null;
  }
  const ext = (String(fileName).split('.').pop() || 'jpeg').toLowerCase();
  return buildUnitTestImageFileName(parsed.prefix, parsed.expected, difficulty, ext);
}

function normalizeRow(raw) {
  const image_file_name = String(
    raw.image_file_name ?? raw.imageFileName ?? raw.file_name ?? raw.filename ?? '',
  ).trim();
  const expected_meter_value = String(
    raw.expected_meter_value ?? raw.expectedMeterValue ?? raw.expected ?? '',
  ).trim();
  const s3_key = String(raw.s3_key ?? raw.s3Key ?? '').trim();
  const image_difficulty = normalizeUnitTestDifficulty(
    raw.image_difficulty ?? raw.imageDifficulty ?? 'normal',
  );
  const row = { image_file_name, expected_meter_value, s3_key, image_difficulty };
  if (raw.capture_location && typeof raw.capture_location === 'object') {
    row.capture_location = raw.capture_location;
  }
  if (raw.source_session_id != null && String(raw.source_session_id).trim()) {
    row.source_session_id = String(raw.source_session_id).trim();
  }
  return row;
}

function rowsFromJsonDocument(doc) {
  const list = Array.isArray(doc?.rows)
    ? doc.rows
    : Array.isArray(doc?.images)
      ? doc.images
      : [];
  return list.map(normalizeRow);
}

function buildJsonDocument(rows) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    rows: rows.map((r) => ({
      image_file_name: r.image_file_name,
      expected_meter_value: r.expected_meter_value,
      s3_key: r.s3_key,
      image_difficulty: r.image_difficulty || 'normal',
    })),
  };
}

async function readJsonManifestRows(s3Client, bucket, jsonKey) {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: jsonKey }));
  const text = await out.Body.transformToString();
  const doc = JSON.parse(text);
  return { key: jsonKey, rows: rowsFromJsonDocument(doc) };
}

async function readLegacyXlsxManifestRows(s3Client, bucket, xlsxKey) {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: xlsxKey }));
  const buf = Buffer.from(await out.Body.transformToByteArray());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { key: xlsxKey, rows: [] };
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeRow);
  return { key: xlsxKey, rows };
}

async function legacyXlsxExists(s3Client, bucket, xlsxKey) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: xlsxKey }));
    return true;
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

export async function readUnitTestManifestRows(s3Client, bucket, workType) {
  const jsonKey = unitTestManifestKey(workType);
  try {
    return await readJsonManifestRows(s3Client, bucket, jsonKey);
  } catch (e) {
    if (e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) {
      throw e;
    }
  }

  const xlsxKey = unitTestManifestLegacyXlsxKey(workType);
  if (!(await legacyXlsxExists(s3Client, bucket, xlsxKey))) {
    return { key: jsonKey, rows: [] };
  }

  const legacy = await readLegacyXlsxManifestRows(s3Client, bucket, xlsxKey);
  if (legacy.rows.length > 0) {
    await writeUnitTestManifestRows(s3Client, bucket, workType, legacy.rows);
    console.log(
      `📋 Migrated unit test manifest ${legacy.rows.length} row(s) from ${xlsxKey} → ${jsonKey}`,
    );
  }
  return { key: jsonKey, rows: legacy.rows };
}

export async function readUnitTestManifestRowsCached(s3Client, bucket, workType) {
  const wt = String(workType || '1000').trim() || '1000';
  const hit = manifestCache.get(wt);
  if (MANIFEST_CACHE_TTL_MS > 0 && hit && Date.now() - hit.timestamp < MANIFEST_CACHE_TTL_MS) {
    return { key: hit.key, rows: hit.rows };
  }
  const fresh = await readUnitTestManifestRows(s3Client, bucket, wt);
  manifestCache.set(wt, { ...fresh, timestamp: Date.now() });
  return fresh;
}

export async function writeUnitTestManifestRows(s3Client, bucket, workType, rows) {
  const key = unitTestManifestKey(workType);
  const body = JSON.stringify(buildJsonDocument(rows), null, 2);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
    }),
  );
  invalidateUnitTestManifestCache(workType);
  return key;
}

/**
 * Insert or update manifest row by s3_key or image_file_name.
 */
export async function upsertUnitTestManifestRow(s3Client, bucket, workType, row) {
  const { rows } = await readUnitTestManifestRowsCached(s3Client, bucket, workType);
  const next = normalizeRow(row);
  let found = false;
  const updated = rows.map((r) => {
    const match =
      (next.s3_key && r.s3_key === next.s3_key) ||
      (next.image_file_name && r.image_file_name === next.image_file_name);
    if (match) {
      found = true;
      return { ...r, ...next };
    }
    return r;
  });
  if (!found) updated.push(next);
  const key = await writeUnitTestManifestRows(s3Client, bucket, workType, updated);
  return { key, rows: updated };
}

export async function removeUnitTestManifestByS3Key(s3Client, bucket, workType, s3Key) {
  const { rows } = await readUnitTestManifestRowsCached(s3Client, bucket, workType);
  const updated = rows.filter((r) => r.s3_key !== s3Key);
  const key = await writeUnitTestManifestRows(s3Client, bucket, workType, updated);
  return { key, rows: updated };
}

/** File name from a unit-test metrics CSV per-image row. */
export function perImageRowFileNameFromCsv(row) {
  const fromKey = String(row?.s3_key || '').split('/').pop() || '';
  return String(row?.filename || row?.image_file_name || fromKey).trim();
}

export function inferWorkTypeFromUnitTestCsvKey(csvKey) {
  const parts = String(csvKey || '').split('/').filter(Boolean);
  const idx = parts.indexOf('unit_test_results');
  if (idx > 0) {
    const candidate = parts[idx - 1];
    if (/^\d{4}$/.test(candidate)) return candidate;
  }
  for (const p of parts) {
    if (/^\d{4}$/.test(p)) return p;
  }
  return '1000';
}

function readingDigits(raw) {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .trim();
}

/** Match metrics CSV row to manifest: exact name, else filename from expected then predicted. */
export function lookupUnitTestManifestByCsvRow(byFile, row) {
  const fn = perImageRowFileNameFromCsv(row);
  if (!fn) return null;

  const direct = byFile.get(fn);
  if (direct) return { fileName: fn, manifest: direct };

  const parsed = parseUnitTestImageFileName(fn);
  if (!parsed) return null;

  const difficulty = normalizeUnitTestDifficulty(row.image_difficulty || parsed.difficulty);
  const ext = fn.split('.').pop() || 'jpeg';
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

/** Replace stale `s3_key` / `filename` from manifest (expected + predicted filenames). */
export async function refreshUnitTestPerImageRowKeys(s3Client, bucket, workType, perImageRows) {
  if (!Array.isArray(perImageRows) || perImageRows.length === 0) return perImageRows;
  const wt = String(workType || '1000').trim() || '1000';
  const { rows: manifestRows } = await readUnitTestManifestRowsCached(s3Client, bucket, wt);
  const byFile = new Map();
  for (const r of manifestRows) {
    if (r.image_file_name) byFile.set(r.image_file_name, r);
  }
  return perImageRows.map((row) => {
    const hit = lookupUnitTestManifestByCsvRow(byFile, row);
    if (!hit) return row;
    const s3Key = hit.manifest.s3_key;
    if (!s3Key || (s3Key === row.s3_key && hit.fileName === perImageRowFileNameFromCsv(row))) {
      return row;
    }
    return { ...row, s3_key: s3Key, filename: hit.fileName };
  });
}
