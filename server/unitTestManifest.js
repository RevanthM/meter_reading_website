/**
 * Read/write `unittestng_manifest.xlsx` on S3 (unit test image registry).
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as XLSX from 'xlsx';

const MANIFEST_FILE = 'unittestng_manifest.xlsx';

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
  return `${unitTestImagesPrefix(workType)}${MANIFEST_FILE}`;
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
  return { image_file_name, expected_meter_value, s3_key, image_difficulty };
}

export async function readUnitTestManifestRows(s3Client, bucket, workType) {
  const key = unitTestManifestKey(workType);
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buf = Buffer.from(await out.Body.transformToByteArray());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { key, rows: [] };
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeRow);
    return { key, rows };
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return { key, rows: [] };
    }
    throw e;
  }
}

export async function writeUnitTestManifestRows(s3Client, bucket, workType, rows) {
  const key = unitTestManifestKey(workType);
  const header = ['image_file_name', 'expected_meter_value', 's3_key', 'image_difficulty'];
  const data = [
    header,
    ...rows.map((r) => [r.image_file_name, r.expected_meter_value, r.s3_key, r.image_difficulty || 'normal']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'manifest');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  return key;
}

/**
 * Insert or update manifest row by s3_key or image_file_name.
 */
export async function upsertUnitTestManifestRow(s3Client, bucket, workType, row) {
  const { rows } = await readUnitTestManifestRows(s3Client, bucket, workType);
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
  const { rows } = await readUnitTestManifestRows(s3Client, bucket, workType);
  const updated = rows.filter((r) => r.s3_key !== s3Key);
  const key = await writeUnitTestManifestRows(s3Client, bucket, workType, updated);
  return { key, rows: updated };
}
