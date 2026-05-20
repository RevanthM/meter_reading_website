/**
 * Portal "Upload & run model" → local Python Combined P3 → awaiting-review S3 sessions.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  buildPortalInferenceSessionId,
  getMeterInferenceStatus,
  portalInferenceFolderPrefix,
  runMeterInferenceOnBuffer,
  warmMeterInferenceWorker,
} from './meterInference.js';

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

function guessImageContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function portalCaptureLocation() {
  return {
    place_label: 'Portal UI',
    coordinate_label: 'Portal UI',
    captured_at: new Date().toISOString(),
  };
}

async function putObject(s3Client, bucket, key, body, contentType) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

function decodeDialJpegBuffers(infer) {
  if (Array.isArray(infer?.dialJpegBuffers) && infer.dialJpegBuffers.length > 0) {
    return infer.dialJpegBuffers;
  }
  const raw = infer?.dial_jpegs_base64;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < Math.min(4, raw.length); i += 1) {
    const b64 = String(raw[i] || '').trim();
    if (!b64) continue;
    try {
      out.push({ dial: i + 1, buffer: Buffer.from(b64, 'base64') });
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

function buildDialSummaries(dialDetails, inferDigits) {
  const rows = Array.isArray(dialDetails) ? dialDetails : [];
  if (rows.length > 0) {
    return rows.slice(0, 4).map((row, i) => ({
      dial: Number(row.dial) || i + 1,
      digit: Number(row.prediction ?? row.stage_3?.digit ?? 0) % 10,
      direction: row.direction,
    }));
  }
  const digits = Array.isArray(inferDigits) ? inferDigits : [];
  return digits.slice(0, 4).map((d, i) => ({
    dial: i + 1,
    digit: Number(d) % 10,
  }));
}

function dialPreviewDataUrls(infer) {
  const raw = infer?.dial_preview_base64 ?? infer?.dial_jpegs_base64;
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((b64) => {
      const s = String(b64 || '').trim();
      return s ? `data:image/jpeg;base64,${s}` : '';
    })
    .filter(Boolean);
}

function buildPortalReadingStub({ sessionId, prefix, metadata, sourceType, workType, dialDetails }) {
  return {
    id: sessionId,
    s3SessionPrefix: prefix,
    dateOfReading: metadata.timestamp,
    location: 'Portal UI',
    type: sourceType,
    status: 'incorrect_new',
    workType,
    meterValue: metadata.ml_prediction,
    rawPrediction: metadata.ml_raw_prediction,
    dialCount: metadata.dial_count,
    dialDetails,
    images: [],
  };
}

async function writePortalInferenceSession(s3Client, bucket, prefix, opts) {
  const { originalBuffer, originalContentType, metadata, dialJpegs } = opts;

  const uploads = [
    putObject(
      s3Client,
      bucket,
      `${prefix}metadata.json`,
      JSON.stringify(metadata),
      'application/json; charset=utf-8',
    ),
    putObject(
      s3Client,
      bucket,
      `${prefix}original.jpg`,
      originalBuffer,
      originalContentType || 'image/jpeg',
    ),
  ];

  for (const dial of dialJpegs || []) {
    if (!dial?.buffer?.length) continue;
    uploads.push(
      putObject(s3Client, bucket, `${prefix}dial_${dial.dial}.jpg`, dial.buffer, 'image/jpeg'),
    );
  }

  await Promise.all(uploads);
}

async function createOnePortalInferenceUpload({
  s3Client,
  BUCKET_NAME,
  withS3Base,
  file,
  workType,
  sourceType,
  userEmail,
  userName,
}) {
  const t0 = Date.now();
  const infer = await runMeterInferenceOnBuffer(file.buffer, file.originalname || 'upload.jpg');
  const inferMs = Date.now() - t0;

  const sessionId = buildPortalInferenceSessionId(workType, sourceType);
  const relPrefix = portalInferenceFolderPrefix(workType, sourceType, sessionId);
  const prefix = withS3Base(relPrefix.endsWith('/') ? relPrefix : `${relPrefix}/`);

  const originalName = String(file.originalname || 'original.jpg').trim();
  const now = new Date().toISOString();
  const reading = String(infer.ml_prediction || infer.reading || '');
  const dialDetails = Array.isArray(infer.dial_details) ? infer.dial_details : [];
  const dialJpegs = decodeDialJpegBuffers(infer);
  const dialSummaries = buildDialSummaries(dialDetails, infer.digits);
  const dialPreviewUrls = dialPreviewDataUrls(infer);

  const metadata = {
    session_id: sessionId,
    timestamp: now,
    work_type: workType,
    work_type_name: workType,
    upload_mode: sourceType,
    image_source: 'portal_upload',
    user_name: userName,
    user_email: userEmail || undefined,
    app_version: 'portal-inference-p3-512',
    is_correct: false,
    is_manually_reviewed: false,
    feedback_type: 'skipped_review',
    ml_prediction: reading,
    ml_raw_prediction: String(infer.ml_raw_prediction || reading),
    user_correction: '',
    dial_count: dialDetails.length || infer.dial_count || 4,
    dial_details: dialDetails,
    confidence: infer.confidence,
    upload_source: 'portal_inference',
    portal_inference_pipeline: infer.pipeline,
    capture_location: portalCaptureLocation(),
    portal_metadata_updated_by: userEmail ? userEmail.slice(0, 320) : undefined,
    status: 'uploaded',
  };

  await writePortalInferenceSession(s3Client, BUCKET_NAME, prefix, {
    originalBuffer: file.buffer,
    originalContentType: file.mimetype || guessImageContentType(originalName),
    metadata,
    dialJpegs,
  });

  const readingRow = buildPortalReadingStub({
    sessionId,
    prefix,
    metadata,
    sourceType,
    workType,
    dialDetails,
  });

  if (inferMs > 3000) {
    console.log(
      `[portal-inference] ${originalName}: inference ${inferMs}ms, upload ${Date.now() - t0 - inferMs}ms`,
    );
  }

  return {
    ok: true,
    sessionId,
    s3SessionPrefix: prefix,
    workType,
    sourceType,
    mlPrediction: reading,
    inferencePipeline: infer.pipeline,
    dialSummaries,
    dialPreviewUrls,
    reading: readingRow,
    fileName: originalName,
    inferMs,
  };
}

export function registerPortalInferenceRoutes(app, deps) {
  const {
    s3Client,
    BUCKET_NAME,
    withS3Base,
    invalidateReadingsCache,
    bulkUploadMiddleware,
  } = deps;

  void warmMeterInferenceWorker();

  app.get('/api/meter-inference/status', (_req, res) => {
    const status = getMeterInferenceStatus();
    res.json({
      ready: status.checks.ready,
      enabled: status.enabled,
      pipeline: 'combined.p3.512 (Python local)',
      workerReady: status.checks.workerReady,
      workerMode: status.checks.workerMode,
      paths: {
        pythonBin: status.pythonBin,
        detectionModel: status.detectionModel,
        keypointModel: status.keypointModel,
      },
      checks: status.checks,
    });
  });

  app.post('/api/portal-uploads/infer-bulk', bulkUploadMiddleware, async (req, res) => {
    try {
      const portalMode = normalizePortalUploaderMode(req.headers['x-portal-work-mode']);
      if (!portalMode) {
        return res.status(403).json({
          error: 'Requires x-portal-work-mode: reviewer, test_data_reviewer, or admin.',
        });
      }

      const status = getMeterInferenceStatus();
      if (!status.checks.ready) {
        return res.status(503).json({
          error:
            'Python meter inference is not configured. Set METER_DETECTION_MODEL and METER_KEYPOINT_MODEL in src/.env (see .env.example).',
          checks: status.checks,
        });
      }

      const files = req.files;
      const list = Array.isArray(files) ? files : files ? [files] : [];
      const valid = list.filter((f) => f?.buffer?.length);
      if (valid.length === 0) {
        return res.status(400).json({ error: 'At least one image file is required.' });
      }

      const workType = String(req.body?.workType || '1000').trim() || '1000';
      const sourceType = normalizeSourceType(req.body?.sourceType);
      const userEmail = String(req.headers['x-user-email'] || req.body?.userEmail || '').trim();
      const userName =
        String(req.body?.userName || userEmail || 'portal-uploader').trim().slice(0, 320) ||
        'portal-uploader';

      const results = [];
      const errors = [];
      for (const file of valid) {
        try {
          const row = await createOnePortalInferenceUpload({
            s3Client,
            BUCKET_NAME,
            withS3Base,
            file,
            workType,
            sourceType,
            userEmail,
            userName,
          });
          results.push(row);
        } catch (e) {
          errors.push({
            fileName: file.originalname || 'image',
            error: e.message || 'Upload with inference failed',
          });
        }
      }

      const httpStatus = results.length > 0 ? (errors.length > 0 ? 207 : 201) : 500;
      res.status(httpStatus).json({
        ok: results.length > 0,
        uploaded: results.length,
        failed: errors.length,
        results,
        errors,
      });
      if (results.length > 0 && invalidateReadingsCache) {
        setImmediate(() => invalidateReadingsCache('all', workType));
      }
      return;
    } catch (e) {
      console.error('POST /api/portal-uploads/infer-bulk:', e);
      res.status(500).json({ error: e.message || 'Portal inference upload failed' });
    }
  });
}
