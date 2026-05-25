/**
 * Test-data reviewer: approve sessions → unit_test_images + unittestng_manifest.json
 */
import archiver from 'archiver';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  buildUnitTestImageFileName,
  normalizeUnitTestDifficulty,
  parseUnitTestImageFileName,
  removeUnitTestManifestByS3Key,
  unitTestImagesPrefix,
  upsertUnitTestManifestRow,
  isUnitTestManifestObjectKey,
  readUnitTestManifestRowsCached,
  writeUnitTestManifestRows,
} from './unitTestManifest.js';

const IMAGE_SUFFIXES = ['.jpg', '.jpeg', '.png', '.webp'];

function canEditTestData(portalMode) {
  const m = String(portalMode || '').trim().toLowerCase();
  return m === 'test_data_reviewer' || m === 'admin';
}

async function readS3ObjectBuffer(s3Client, bucket, key) {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (typeof out.Body?.transformToByteArray === 'function') {
    return Buffer.from(await out.Body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of out.Body || []) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function normalizeReviewerDatasetDestination(raw) {
  const d = String(raw ?? '').trim().toLowerCase();
  if (d === 'test' || d === 'training') return d;
  return null;
}

function normalizeTestDataReviewStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'approved' || s === 'pending') return s;
  return null;
}

/**
 * True when session is in the test-data queue or already approved into unit_test_images.
 * Uses live metadata.json and optional list snapshot (handles stale S3 list cache / duplicate folders).
 */
export function isSessionInTestDatasetQueueOrLibrary(meta, reading) {
  const dest = normalizeReviewerDatasetDestination(meta?.reviewer_dataset_destination);
  const status = normalizeTestDataReviewStatus(meta?.test_data_review_status);
  const unitKey = String(meta?.test_data_unit_test_s3_key || '').trim();

  if (dest === 'test') return true;
  if (status === 'approved' || status === 'pending') return true;
  if (unitKey) return true;

  if (reading && typeof reading === 'object') {
    if (reading.reviewerDatasetDestination === 'test') return true;
    if (reading.testDataReviewStatus === 'approved' || reading.testDataReviewStatus === 'pending') {
      return true;
    }
    if (String(reading.testDataUnitTestS3Key || '').trim()) return true;
  }

  return false;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function guessContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function findSessionOriginalKey(s3Client, bucket, sessionPrefix) {
  const norm = sessionPrefix.endsWith('/') ? sessionPrefix : `${sessionPrefix}/`;
  const list = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: norm, MaxKeys: 200 }),
  );
  const contents = list.Contents || [];
  const original = contents.find((o) => (o.Key?.split('/').pop() || '').toLowerCase() === 'original.jpg');
  if (original?.Key) return original.Key;
  const anyImage = contents.find((o) => {
    const name = (o.Key || '').toLowerCase();
    return IMAGE_SUFFIXES.some((s) => name.endsWith(s));
  });
  return anyImage?.Key || null;
}

function expectedFromMetadata(meta) {
  const uc = meta?.user_correction;
  if (uc != null && String(uc).trim() !== '') return String(uc).trim();
  const ml = meta?.ml_prediction;
  if (ml != null && String(ml).trim() !== '') return String(ml).trim();
  return '';
}

/**
 * @param {{ s3Client, bucket: string, workType: string, sessionPrefix: string, meta: object, userEmail?: string }} opts
 */
export async function approveSessionForUnitTest(opts) {
  const workType = String(opts.workType || opts.meta?.work_type || '1000').trim() || '1000';
  const prefix = unitTestImagesPrefix(workType);
  const dialCount = opts.meta?.dial_count ?? (Array.isArray(opts.meta?.dial_details) ? opts.meta.dial_details.length : 1);
  const expected = expectedFromMetadata(opts.meta);
  if (!expected) {
    throw new Error('Set a corrected reading (user_correction) before approving for unit test.');
  }

  const difficulty = normalizeUnitTestDifficulty(opts.meta?.image_difficulty);
  const priorFileName = String(opts.meta?.test_data_unit_test_file_name || '').trim();
  const priorParsed = priorFileName ? parseUnitTestImageFileName(priorFileName) : null;
  const filePrefix = priorParsed?.prefix ?? String(dialCount);

  const sourceKey = await findSessionOriginalKey(opts.s3Client, opts.bucket, opts.sessionPrefix);
  if (!sourceKey) {
    throw new Error('No original.jpg (or image) found in this session folder.');
  }

  const sourceExt = (sourceKey.split('.').pop() || 'jpg').toLowerCase();
  const ext = sourceExt === 'jpg' ? 'jpeg' : sourceExt;
  const fileName = buildUnitTestImageFileName(filePrefix, expected, difficulty, ext);
  const destKey = `${prefix}${fileName}`;

  const priorKey = String(opts.meta?.test_data_unit_test_s3_key || '').trim();
  if (priorKey && priorKey !== destKey) {
    try {
      await opts.s3Client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: priorKey }));
    } catch {
      /* ignore */
    }
    try {
      await removeUnitTestManifestByS3Key(opts.s3Client, opts.bucket, workType, priorKey);
    } catch {
      /* ignore */
    }
  }

  const sameBucketCopy = priorKey === destKey;
  if (sameBucketCopy) {
    const obj = await opts.s3Client.send(
      new GetObjectCommand({ Bucket: opts.bucket, Key: sourceKey }),
    );
    const body = await streamToBuffer(obj.Body);
    await opts.s3Client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: destKey,
        Body: body,
        ContentType: guessContentType(fileName),
      }),
    );
  } else {
    await opts.s3Client.send(
      new CopyObjectCommand({
        Bucket: opts.bucket,
        CopySource: `${opts.bucket}/${sourceKey}`,
        Key: destKey,
        ContentType: guessContentType(fileName),
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  const manifestKey = await upsertUnitTestManifestRow(opts.s3Client, opts.bucket, workType, {
    image_file_name: fileName,
    expected_meter_value: expected,
    s3_key: destKey,
    image_difficulty: difficulty,
  });

  const now = new Date().toISOString();
  opts.meta.test_data_review_status = 'approved';
  opts.meta.test_data_approved_at = now;
  if (opts.userEmail) {
    opts.meta.test_data_approved_by = String(opts.userEmail).slice(0, 320);
  }
  opts.meta.test_data_unit_test_s3_key = destKey;
  opts.meta.test_data_unit_test_file_name = fileName;
  opts.meta.reviewer_dataset_destination = 'test';

  return {
    workType,
    fileName,
    s3Key: destKey,
    manifestKey,
    expectedMeterValue: expected,
    approvedAt: now,
  };
}

/**
 * Remove session from test dataset queue. If already approved into unit_test_images/, also delete S3 + manifest row.
 * @param {{ s3Client, bucket: string, workType: string, meta: object }} opts
 */
export async function removeSessionFromTestDataset(opts) {
  const workType = String(opts.workType || opts.meta?.work_type || '1000').trim() || '1000';
  const unitTestKey = String(opts.meta?.test_data_unit_test_s3_key || '').trim();
  const wasApproved =
    opts.meta?.test_data_review_status === 'approved' || Boolean(unitTestKey);

  if (unitTestKey) {
    try {
      await opts.s3Client.send(
        new DeleteObjectCommand({ Bucket: opts.bucket, Key: unitTestKey }),
      );
    } catch (e) {
      if (e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) {
        throw e;
      }
    }
    try {
      await removeUnitTestManifestByS3Key(opts.s3Client, opts.bucket, workType, unitTestKey);
    } catch {
      /* ignore manifest errors */
    }
  }

  opts.meta.reviewer_dataset_destination = null;
  opts.meta.reviewer_recommend_training = false;
  opts.meta.test_data_review_status = null;
  opts.meta.test_data_unit_test_s3_key = null;
  opts.meta.test_data_unit_test_file_name = null;
  opts.meta.test_data_approved_at = null;
  opts.meta.test_data_approved_by = null;
  opts.meta.test_data_submitted_at = null;
  opts.meta.test_data_submitted_by = null;

  return {
    workType,
    removedFromQueue: true,
    removedFromS3: wasApproved && Boolean(unitTestKey),
    deletedS3Key: unitTestKey || null,
  };
}

/**
 * Update expected reading / difficulty for an existing unit test image (manifest + S3 rename when needed).
 * @param {{ s3Client, bucket: string, workType: string, s3Key: string, expectedMeterValue: string, imageDifficulty?: string }} opts
 */
export async function updateUnitTestImageExpected(opts) {
  const workType = String(opts.workType || '1000').trim() || '1000';
  const prefix = unitTestImagesPrefix(workType);
  const s3Key = String(opts.s3Key || '').trim();
  const expected = String(opts.expectedMeterValue ?? '').trim();
  const difficulty = normalizeUnitTestDifficulty(opts.imageDifficulty);
  if (!s3Key) throw new Error('s3Key is required.');
  if (!expected) throw new Error('expectedMeterValue is required.');
  if (!s3Key.startsWith(prefix)) throw new Error('Not a unit test image in this work type prefix.');

  const oldFileName = s3Key.slice(prefix.length);
  const parsed = parseUnitTestImageFileName(oldFileName);
  if (!parsed) {
    throw new Error('Filename must be {prefix}_d{1|2|3}_{expectedReading}.ext');
  }
  const ext = (oldFileName.split('.').pop() || 'jpeg').toLowerCase();
  const newFileName = buildUnitTestImageFileName(parsed.prefix, expected, difficulty, ext);
  const newKey = `${prefix}${newFileName}`;

  if (newKey !== s3Key) {
    const existing = await opts.s3Client.send(
      new ListObjectsV2Command({ Bucket: opts.bucket, Prefix: newKey, MaxKeys: 1 }),
    );
    if ((existing.Contents || []).some((o) => o.Key === newKey)) {
      throw new Error(`Target key already exists: ${newFileName}`);
    }
    await opts.s3Client.send(
      new CopyObjectCommand({
        Bucket: opts.bucket,
        CopySource: `${opts.bucket}/${s3Key}`,
        Key: newKey,
        ContentType: guessContentType(newFileName),
        MetadataDirective: 'REPLACE',
      }),
    );
    await opts.s3Client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: s3Key }));
  }

  const { rows } = await readUnitTestManifestRows(opts.s3Client, opts.bucket, workType);
  let found = false;
  const updatedRows = rows.map((r) => {
    const match = r.s3_key === s3Key || r.image_file_name === oldFileName;
    if (!match) return r;
    found = true;
    return {
      image_file_name: newFileName,
      expected_meter_value: expected,
      s3_key: newKey,
      image_difficulty: difficulty,
    };
  });
  if (!found) {
    updatedRows.push({
      image_file_name: newFileName,
      expected_meter_value: expected,
      s3_key: newKey,
      image_difficulty: difficulty,
    });
  }
  const manifestKey = await writeUnitTestManifestRows(opts.s3Client, opts.bucket, workType, updatedRows);

  return {
    workType,
    fileName: newFileName,
    s3Key: newKey,
    priorS3Key: s3Key,
    expectedMeterValue: expected,
    imageDifficulty: difficulty,
    manifestKey,
    renamed: newKey !== s3Key,
  };
}

/**
 * Delete a unit test image from S3 and manifest (gallery delete; does not touch session folders).
 */
export async function deleteUnitTestImage(opts) {
  const workType = String(opts.workType || '1000').trim() || '1000';
  const prefix = unitTestImagesPrefix(workType);
  const s3Key = String(opts.s3Key || '').trim();
  if (!s3Key) throw new Error('s3Key is required.');
  if (!s3Key.startsWith(prefix)) throw new Error('Not a unit test image in this work type prefix.');

  try {
    await opts.s3Client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: s3Key }));
  } catch (e) {
    if (e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) {
      throw e;
    }
  }
  const { key: manifestKey } = await removeUnitTestManifestByS3Key(opts.s3Client, opts.bucket, workType, s3Key);
  return { workType, s3Key, manifestKey, deleted: true };
}

export async function listUnitTestImages(s3Client, bucket, workType) {
  const prefix = unitTestImagesPrefix(workType);
  const images = [];
  let token;
  do {
    const out = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of out.Contents || []) {
      const key = o.Key || '';
      const name = key.slice(prefix.length);
      if (!name || name.includes('/')) continue;
      const lower = name.toLowerCase();
      if (!IMAGE_SUFFIXES.some((s) => lower.endsWith(s))) continue;
      if (isUnitTestManifestObjectKey(name)) continue;
      images.push({
        s3Key: key,
        fileName: name,
        size: o.Size,
        lastModified: o.LastModified?.toISOString?.() || null,
      });
    }
    token = out.NextContinuationToken;
  } while (token);

  const { rows: manifestRows, key: manifestKey } = await readUnitTestManifestRowsCached(s3Client, bucket, workType);
  const byKey = new Map(manifestRows.map((r) => [r.s3_key || `${prefix}${r.image_file_name}`, r]));

  return {
    prefix,
    manifestKey,
    images: images.map((img) => {
      const row = byKey.get(img.s3Key);
      const parsed = parseUnitTestImageFileName(img.fileName);
      return {
        ...img,
        expectedMeterValue: row?.expected_meter_value || parsed?.expected || null,
        imageDifficulty: row?.image_difficulty || parsed?.difficulty || 'normal',
      };
    }),
    manifestRows,
  };
}

export async function getUnitTestImageByFileName(s3Client, bucket, workType, fileName) {
  const safeName = String(fileName || '').split('/').pop() || '';
  if (!safeName) return null;
  const prefix = unitTestImagesPrefix(workType);
  const s3Key = `${prefix}${safeName}`;
  const { rows: manifestRows } = await readUnitTestManifestRowsCached(s3Client, bucket, workType);
  const row = manifestRows.find((r) => r.image_file_name === safeName || r.s3_key === s3Key);
  const parsed = parseUnitTestImageFileName(safeName);
  return {
    s3Key: row?.s3_key || s3Key,
    fileName: safeName,
    expectedMeterValue: row?.expected_meter_value || parsed?.expected || null,
    imageDifficulty: row?.image_difficulty || parsed?.difficulty || 'normal',
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ s3Client, BUCKET_NAME: string, resolveReadingById: Function, normalizeS3SessionPrefix: Function, streamToString: Function, getPresignedUrl: Function, invalidateReadingsCache?: Function }} deps
 */
export function registerTestDataReviewRoutes(app, deps) {
  const {
    s3Client,
    BUCKET_NAME,
    resolveReadingById,
    normalizeS3SessionPrefix,
    streamToString,
    getPresignedUrl,
    invalidateReadingsCache,
    syncSessionIndexFromMetadata,
  } = deps;

  app.get('/api/test-data/unit-test-images', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const presignAll = req.query.presign === '1' || req.query.presign === 'true';
      const data = await listUnitTestImages(s3Client, BUCKET_NAME, workType);
      if (!presignAll) {
        return res.json(data);
      }
      const images = await Promise.all(
        data.images.map(async (img) => ({
          ...img,
          url: await getPresignedUrl(img.s3Key),
        })),
      );
      res.json({ ...data, images });
    } catch (e) {
      console.error('GET /api/test-data/unit-test-images:', e);
      res.status(500).json({ error: e.message || 'Failed to list unit test images' });
    }
  });

  app.get('/api/test-data/unit-test-images/by-file/:fileName', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      let fileName = req.params.fileName || '';
      try {
        fileName = decodeURIComponent(fileName);
      } catch {
        /* keep raw */
      }
      const row = await getUnitTestImageByFileName(s3Client, BUCKET_NAME, workType, fileName);
      if (!row) {
        return res.status(404).json({ error: 'Image not found.' });
      }
      const url = await getPresignedUrl(row.s3Key);
      res.json({ ...row, url, workType });
    } catch (e) {
      console.error('GET /api/test-data/unit-test-images/by-file:', e);
      res.status(500).json({ error: e.message || 'Failed to load unit test image' });
    }
  });

  app.get('/api/test-data/unit-test-images/download', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const s3Key = String(req.query.s3Key || '').trim();
      if (!s3Key) return res.status(400).json({ error: 's3Key is required.' });

      const prefix = unitTestImagesPrefix(workType);
      if (!s3Key.startsWith(prefix)) {
        return res.status(400).json({ error: 's3Key is not under the unit test images prefix.' });
      }
      const fileName = s3Key.slice(prefix.length);
      if (!fileName || fileName.includes('/') || isUnitTestManifestObjectKey(fileName)) {
        return res.status(400).json({ error: 'Invalid unit test image key.' });
      }

      const buf = await readS3ObjectBuffer(s3Client, BUCKET_NAME, s3Key);
      const lower = fileName.toLowerCase();
      const contentType = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
      res.send(buf);
    } catch (e) {
      console.error('GET /api/test-data/unit-test-images/download:', e);
      if (!res.headersSent) {
        res.status(e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404 ? 404 : 500).json({
          error: e.message || 'Failed to download unit test image',
        });
      }
    }
  });

  app.get('/api/test-data/unit-test-images/download-zip', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const data = await listUnitTestImages(s3Client, BUCKET_NAME, workType);
      if (!data.images.length) {
        return res.status(404).json({ error: 'No unit test images to download.' });
      }

      const manifestFileName = data.manifestKey?.split('/').pop() || 'unittestng_manifest.json';
      const zipName = `unit-test-images-${workType}-${Date.now()}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.setHeader('X-Unit-Test-Image-Count', String(data.images.length));

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('warning', (err) => console.warn('unit-test-images zip warning:', err.message));
      archive.on('error', (err) => {
        console.error('unit-test-images zip error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      archive.pipe(res);

      if (data.manifestKey) {
        try {
          const manifestBuf = await readS3ObjectBuffer(s3Client, BUCKET_NAME, data.manifestKey);
          archive.append(manifestBuf, { name: manifestFileName });
        } catch (e) {
          console.warn('unit-test-images zip: manifest read failed, building from rows:', e.message);
          const body = JSON.stringify(
            {
              version: 1,
              updatedAt: new Date().toISOString(),
              rows: (data.manifestRows || []).map((r) => ({
                image_file_name: r.image_file_name,
                expected_meter_value: r.expected_meter_value,
                s3_key: r.s3_key,
                image_difficulty: r.image_difficulty || 'normal',
              })),
            },
            null,
            2,
          );
          archive.append(Buffer.from(body, 'utf8'), { name: manifestFileName });
        }
      }

      for (const img of data.images) {
        try {
          const buf = await readS3ObjectBuffer(s3Client, BUCKET_NAME, img.s3Key);
          archive.append(buf, { name: img.fileName });
        } catch (e) {
          console.warn(`unit-test-images zip: skip ${img.s3Key}:`, e.message);
        }
      }

      await archive.finalize();
    } catch (e) {
      console.error('GET /api/test-data/unit-test-images/download-zip:', e);
      if (!res.headersSent) {
        res.status(500).json({ error: e.message || 'Failed to build unit test images ZIP' });
      }
    }
  });

  app.post('/api/test-data/unit-test-images/presign', async (req, res) => {
    try {
      const keys = req.body?.s3Keys;
      if (!Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ error: 's3Keys must be a non-empty array.' });
      }
      if (keys.length > 250) {
        return res.status(400).json({ error: 'Too many keys (max 250 per request).' });
      }
      const unique = [...new Set(keys.map((k) => String(k || '').trim()).filter(Boolean))];
      const urls = {};
      await Promise.all(
        unique.map(async (s3Key) => {
          urls[s3Key] = await getPresignedUrl(s3Key);
        }),
      );
      res.json({ urls });
    } catch (e) {
      console.error('POST /api/test-data/unit-test-images/presign:', e);
      res.status(500).json({ error: e.message || 'Failed to presign unit test images' });
    }
  });

  app.patch('/api/test-data/unit-test-images', async (req, res) => {
    try {
      const portalMode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
      if (!canEditTestData(portalMode)) {
        return res.status(403).json({ error: 'Requires test_data_reviewer or admin role.' });
      }

      const workType = String(req.body?.workType || req.query?.workType || '1000').trim() || '1000';
      const s3Key = String(req.body?.s3Key || '').trim();
      const expectedMeterValue = String(req.body?.expectedMeterValue ?? '').trim();
      const imageDifficulty = req.body?.imageDifficulty ?? req.body?.image_difficulty;
      if (!s3Key) return res.status(400).json({ error: 's3Key is required.' });
      if (!expectedMeterValue) return res.status(400).json({ error: 'expectedMeterValue is required.' });

      const result = await updateUnitTestImageExpected({
        s3Client,
        bucket: BUCKET_NAME,
        workType,
        s3Key,
        expectedMeterValue,
        imageDifficulty,
      });

      const url = await getPresignedUrl(result.s3Key);
      res.json({ ok: true, ...result, url });
    } catch (e) {
      console.error('PATCH /api/test-data/unit-test-images:', e);
      res.status(502).json({ error: e.message || 'Failed to update unit test image' });
    }
  });

  app.delete('/api/test-data/unit-test-images', async (req, res) => {
    try {
      const portalMode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
      if (!canEditTestData(portalMode)) {
        return res.status(403).json({ error: 'Requires test_data_reviewer or admin role.' });
      }

      const workType = String(req.body?.workType || req.query?.workType || '1000').trim() || '1000';
      const s3Key = String(req.body?.s3Key || req.query?.s3Key || '').trim();
      if (!s3Key) return res.status(400).json({ error: 's3Key is required.' });

      const result = await deleteUnitTestImage({
        s3Client,
        bucket: BUCKET_NAME,
        workType,
        s3Key,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      console.error('DELETE /api/test-data/unit-test-images:', e);
      res.status(502).json({ error: e.message || 'Failed to delete unit test image' });
    }
  });

  app.post('/api/test-data/remove-from-dataset', async (req, res) => {
    try {
      const portalMode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
      if (!canEditTestData(portalMode)) {
        return res.status(403).json({ error: 'Requires test_data_reviewer or admin role.' });
      }

      const sessionId = String(req.body?.sessionId || req.body?.id || '').trim();
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required.' });
      }

      const workTypeHint = typeof req.body?.workType === 'string' ? req.body.workType.trim() : '';
      const clientPrefix = normalizeS3SessionPrefix(req.body?.s3SessionPrefix);
      const reading = await resolveReadingById(sessionId, {
        workTypeHint,
        s3SessionPrefix: clientPrefix,
      });
      if (!reading?.s3SessionPrefix) {
        return res.status(404).json({ error: 'Reading not found.' });
      }

      const serverPrefix = clientPrefix || normalizeS3SessionPrefix(reading.s3SessionPrefix);
      const metaKey = `${serverPrefix}metadata.json`;
      const getOut = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey }));
      const meta = JSON.parse(await streamToString(getOut.Body));

      if (!isSessionInTestDatasetQueueOrLibrary(meta, reading)) {
        return res.status(400).json({
          error: 'Session is not in the test dataset queue or unit test library.',
        });
      }

      const userEmail = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'].trim() : '';

      const result = await removeSessionFromTestDataset({
        s3Client,
        bucket: BUCKET_NAME,
        workType: reading.workType || workTypeHint || '1000',
        meta,
      });

      meta.portal_metadata_updated_at = new Date().toISOString();
      if (userEmail) meta.portal_metadata_updated_by = userEmail.slice(0, 320);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: metaKey,
          Body: JSON.stringify(meta, null, 2),
          ContentType: 'application/json',
        }),
      );

      if (typeof syncSessionIndexFromMetadata === 'function') {
        await syncSessionIndexFromMetadata(meta, {
          s3SessionPrefix: serverPrefix,
          folderStatus: reading.status,
          sourceType: reading.type,
          portalWorkType: reading.workType || workTypeHint || '1000',
        });
      }

      if (typeof invalidateReadingsCache === 'function') {
        invalidateReadingsCache('all', reading.workType || workTypeHint || '1000');
      }

      const fresh = await resolveReadingById(sessionId, {
        workTypeHint,
        s3SessionPrefix: serverPrefix,
      });
      res.json({ ok: true, ...result, reading: fresh });
    } catch (e) {
      console.error('POST /api/test-data/remove-from-dataset:', e);
      res.status(502).json({ error: e.message || 'Remove from test dataset failed' });
    }
  });

  app.post('/api/test-data/approve', async (req, res) => {
    try {
      const portalMode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
      if (!canEditTestData(portalMode)) {
        return res.status(403).json({ error: 'Requires test_data_reviewer or admin role.' });
      }

      const sessionId = String(req.body?.sessionId || req.body?.id || '').trim();
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required.' });
      }

      const workTypeHint = typeof req.body?.workType === 'string' ? req.body.workType.trim() : '';
      const clientPrefix = normalizeS3SessionPrefix(req.body?.s3SessionPrefix);
      const reading = await resolveReadingById(sessionId, {
        workTypeHint,
        s3SessionPrefix: clientPrefix,
      });
      if (!reading?.s3SessionPrefix) {
        return res.status(404).json({ error: 'Reading not found.' });
      }

      const serverPrefix = clientPrefix || normalizeS3SessionPrefix(reading.s3SessionPrefix);
      const metaKey = `${serverPrefix}metadata.json`;
      const getOut = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey }));
      const meta = JSON.parse(await streamToString(getOut.Body));

      if (meta.reviewer_dataset_destination !== 'test') {
        return res.status(400).json({
          error: 'Session is not marked send to test dataset. Reviewer must select that before approval.',
        });
      }

      const userEmail = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'].trim() : '';

      const result = await approveSessionForUnitTest({
        s3Client,
        bucket: BUCKET_NAME,
        workType: reading.workType || workTypeHint || '1000',
        sessionPrefix: serverPrefix,
        meta,
        userEmail,
      });

      meta.portal_metadata_updated_at = new Date().toISOString();
      if (userEmail) meta.portal_metadata_updated_by = userEmail.slice(0, 320);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: metaKey,
          Body: JSON.stringify(meta, null, 2),
          ContentType: 'application/json',
        }),
      );

      if (typeof syncSessionIndexFromMetadata === 'function') {
        await syncSessionIndexFromMetadata(meta, {
          s3SessionPrefix: serverPrefix,
          folderStatus: reading.status,
          sourceType: reading.type,
          portalWorkType: reading.workType || workTypeHint || '1000',
        });
      }

      if (typeof invalidateReadingsCache === 'function') {
        invalidateReadingsCache('all', reading.workType || workTypeHint || '1000');
      }

      const fresh = await resolveReadingById(sessionId, {
        workTypeHint,
        s3SessionPrefix: serverPrefix,
      });
      res.json({ ok: true, ...result, reading: fresh });
    } catch (e) {
      console.error('POST /api/test-data/approve:', e);
      res.status(502).json({ error: e.message || 'Approve for unit test failed' });
    }
  });
}
