/**
 * Portal manual upload: images → `{workType}/manually_uploaded/{sessionId}/`
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const BULK_MAX_FILES = Math.max(1, Math.min(100, parseInt(process.env.MANUAL_UPLOAD_MAX_FILES || '50', 10) || 50));

function normalizePortalUploaderMode(raw) {
  const m = String(raw || '').trim().toLowerCase();
  if (m === 'reviewer' || m === 'admin' || m === 'test_data_reviewer') return m;
  return null;
}

function normalizeSourceType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'field' || t === 'simulator') return t;
  return 'simulator';
}

/** Exactly four digits (leading zeros allowed). */
export function normalizeFourDigitReading(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 4) return null;
  return digits;
}

function guessImageContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function manualUploadFolderPrefix(workType, sessionId) {
  const wt = String(workType || '1000').trim() || '1000';
  const id = String(sessionId).trim();
  return `${wt}/manually_uploaded/${id}/`;
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} BUCKET_NAME
 * @param {string} prefix — full S3 prefix with trailing slash
 * @param {Buffer} buffer
 * @param {string} imageFileName
 * @param {string} contentType
 * @param {object} metadata
 */
async function writeManualSession(s3Client, BUCKET_NAME, prefix, buffer, imageFileName, contentType, metadata) {
  const metaKey = `${prefix}metadata.json`;
  const imageKey = `${prefix}${imageFileName}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: metaKey,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json; charset=utf-8',
    }),
  );
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: imageKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

async function createOneManualUpload({
  s3Client,
  BUCKET_NAME,
  withS3Base,
  parseSession,
  file,
  workType,
  sourceType,
  expectedReading,
  userEmail,
  userName,
}) {
  const labeled = normalizeFourDigitReading(expectedReading);
  const sessionId = `manual-${randomUUID()}`;
  const relPrefix = manualUploadFolderPrefix(workType, sessionId);
  const prefix = withS3Base(relPrefix.endsWith('/') ? relPrefix : `${relPrefix}/`);

  const originalName = String(file.originalname || 'original.jpg').trim();
  const imageFileName = IMAGE_EXT.test(originalName) ? originalName : 'original.jpg';
  const now = new Date().toISOString();

  const metadata = {
    session_id: sessionId,
    timestamp: now,
    work_type: workType,
    work_type_name: workType,
    upload_mode: sourceType,
    image_source: 'gallery',
    user_name: userName,
    user_email: userEmail || undefined,
    app_version: 'portal-manual-upload',
    is_correct: Boolean(labeled),
    is_manually_reviewed: Boolean(labeled),
    feedback_type: labeled ? 'correct' : 'pending',
    ml_prediction: labeled || '',
    ml_raw_prediction: labeled || '',
    user_correction: labeled || '',
    dial_count: 0,
    dial_details: [],
    upload_source: 'portal_manual',
    manual_label_pending: !labeled,
    portal_metadata_updated_by: userEmail ? userEmail.slice(0, 320) : undefined,
    status: 'manually_uploaded',
  };

  await writeManualSession(
    s3Client,
    BUCKET_NAME,
    prefix,
    file.buffer,
    imageFileName,
    file.mimetype || guessImageContentType(imageFileName),
    metadata,
  );

  const reading = await parseSession(prefix, 'manually_uploaded', sourceType, workType);
  return {
    ok: true,
    sessionId,
    s3SessionPrefix: prefix,
    workType,
    sourceType,
    expectedReading: labeled,
    labeled: Boolean(labeled),
    reading,
    fileName: originalName,
  };
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   s3Client: import('@aws-sdk/client-s3').S3Client,
 *   BUCKET_NAME: string,
 *   withS3Base: (p: string) => string,
 *   invalidateCache?: () => void,
 *   parseSession: Function,
 *   uploadMiddleware: Function,
 *   bulkUploadMiddleware: Function,
 * }} deps
 */
export function registerManualUploadRoutes(app, deps) {
  const {
    s3Client,
    BUCKET_NAME,
    withS3Base,
    invalidateCache,
    parseSession,
    uploadMiddleware,
    bulkUploadMiddleware,
  } = deps;

  async function handleUpload(req, res, files) {
    const portalMode = normalizePortalUploaderMode(req.headers['x-portal-work-mode']);
    if (!portalMode) {
      return res.status(403).json({
        error: 'Requires x-portal-work-mode: reviewer, test_data_reviewer, or admin.',
      });
    }

    const list = Array.isArray(files) ? files : files ? [files] : [];
    const valid = list.filter((f) => f?.buffer?.length);
    if (valid.length === 0) {
      return res.status(400).json({ error: 'At least one image file is required.' });
    }
    if (valid.length > BULK_MAX_FILES) {
      return res.status(400).json({ error: `Too many files (max ${BULK_MAX_FILES}).` });
    }

    const workType = String(req.body?.workType || '1000').trim() || '1000';
    const sourceType = normalizeSourceType(req.body?.sourceType);
    const expectedReading = req.body?.expectedReading
      ? normalizeFourDigitReading(req.body.expectedReading)
      : null;
    if (req.body?.expectedReading && !expectedReading) {
      return res.status(400).json({ error: 'expectedReading must be exactly 4 digits when provided.' });
    }

    const userEmail = String(req.headers['x-user-email'] || req.body?.userEmail || '').trim();
    const userName =
      String(req.body?.userName || userEmail || 'portal-uploader').trim().slice(0, 320) || 'portal-uploader';

    const results = [];
    const errors = [];
    for (const file of valid) {
      try {
        const row = await createOneManualUpload({
          s3Client,
          BUCKET_NAME,
          withS3Base,
          parseSession,
          file,
          workType,
          sourceType,
          expectedReading: valid.length === 1 ? expectedReading : null,
          userEmail,
          userName,
        });
        results.push(row);
      } catch (e) {
        errors.push({
          fileName: file.originalname || 'image',
          error: e.message || 'Upload failed',
        });
      }
    }

    if (invalidateCache) invalidateCache();

    const status = results.length > 0 ? (errors.length > 0 ? 207 : 201) : 500;
    return res.status(status).json({
      ok: results.length > 0,
      uploaded: results.length,
      failed: errors.length,
      results,
      errors,
    });
  }

  app.post('/api/manual-uploads', uploadMiddleware, async (req, res) => {
    try {
      await handleUpload(req, res, req.file ? [req.file] : []);
    } catch (e) {
      console.error('POST /api/manual-uploads:', e);
      res.status(500).json({ error: e.message || 'Manual upload failed' });
    }
  });

  app.post('/api/manual-uploads/bulk', bulkUploadMiddleware, async (req, res) => {
    try {
      const files = req.files;
      await handleUpload(req, res, files);
    } catch (e) {
      console.error('POST /api/manual-uploads/bulk:', e);
      res.status(500).json({ error: e.message || 'Bulk manual upload failed' });
    }
  });
}

export { manualUploadFolderPrefix, BULK_MAX_FILES };
