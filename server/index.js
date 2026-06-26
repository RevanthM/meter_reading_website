import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import admin from 'firebase-admin';
import { registerRoboflowRoutes } from './roboflow.js';
import {
  registerTrainingDatasetRoboflowRoutes,
  normalizePipelineIterationTrainingDatasetLinks,
  normalizeTrainingDatasetRoboflowTraining,
} from './roboflowTrainingDataset.js';
import { pullWeightsPtFromRoboflow } from './roboflowWeights.js';
import { registerApiDocs } from './apiDocs.js';
import {
  enrichUnitTestRunsWithSummary,
  listUnitTestResultCsvKeys,
  parseUnitTestCsvSummary,
} from './unitTestCsv.js';
import {
  inferWorkTypeFromUnitTestCsvKey,
  refreshUnitTestPerImageRowKeys,
} from './unitTestManifest.js';
import { createImprovementAnalyticsStore, calendarDayKeyInPortalTz } from './improvementAnalytics.js';
import { createResponseCache, parseCacheMs, setApiCacheHeaders } from './responseCache.js';
import { registerTestDataReviewRoutes } from './testDataReview.js';
import { registerFieldTestRoutes } from './fieldTestRoutes.js';
import { registerAuditEventRoutes, appendAuditEvents } from './auditEvents.js';
import { registerReviewAssignmentRoutes } from './reviewAssignments.js';
import { isAdminPortalRequest } from './portalAdminAccess.js';
import { registerManualUploadRoutes } from './manualUpload.js';
import { portalManualReviewFromMetadata } from './portalManualReview.js';
import { inferReadsCorrectedFromMetadata } from './fieldTestDerive.js';
// Portal local Python inference disabled (requires a machine with YOLO weights).
// import { registerPortalInferenceRoutes } from './portalInferenceUpload.js';
import archiver from 'archiver';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import {
  createSessionIndexStore,
  attachPrimaryListImages,
  readingFromDynamoItem,
} from './sessionIndex/index.js';
import {
  syncSessionIndexFromMetadata,
  syncSessionIndexAfterMove,
} from './sessionIndex/syncHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
// Root `.env` first, then `src/.env` (later wins) — supports AWS creds in `src/.env` for local dev.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

/** Prefer AWS_PROFILE when set (src/.env may contain a different IAM user without Dynamo). */
if (process.env.AWS_PROFILE) {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
}

// --- Firebase Admin SDK ---
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY;
try {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
    console.log('🔐 Firebase Admin SDK initialized');
  } else {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_BASE64 not set — email link MFA bypass disabled');
  }
} catch (err) {
  console.error('❌ Firebase Admin SDK init failed:', err.message);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const distDir = path.join(__dirname, '../dist');
app.use(
  express.static(distDir, {
    setHeaders(res, filePath) {
      // Avoid stale SPA shell pointing at old hashed JS after deploy/local rebuild.
      if (filePath.endsWith(`${path.sep}index.html`) || filePath.endsWith('/index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  }),
);

const BUCKET_NAME = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
/**
 * Improvement chart index — same bucket as sessions, under `analytics/improvement/…`.
 * Index file: s3://{bucket}/analytics/improvement/all/1000/index.json
 *
 * Do not set AWS_ANALYTICS_S3_BUCKET unless that bucket exists and your IAM key can read/write it.
 * (An empty prefix is only used when AWS_ANALYTICS_S3_KEY_PREFIX is explicitly set to "".)
 */
const ANALYTICS_BUCKET_NAME = (process.env.AWS_ANALYTICS_S3_BUCKET || BUCKET_NAME).trim();
const ANALYTICS_KEY_PREFIX = (() => {
  if (process.env.AWS_ANALYTICS_S3_KEY_PREFIX != null) {
    return String(process.env.AWS_ANALYTICS_S3_KEY_PREFIX).trim().replace(/^\/+|\/+$/g, '');
  }
  return 'analytics';
})();
const ANALYTICS_USE_DEDICATED_BUCKET = ANALYTICS_BUCKET_NAME !== BUCKET_NAME;
/** When a dedicated analytics bucket is misconfigured, read from the sessions bucket + analytics/ prefix. */
const ANALYTICS_FALLBACK_BUCKET =
  ANALYTICS_BUCKET_NAME !== BUCKET_NAME ? BUCKET_NAME : undefined;
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
const DYNAMO_SESSIONS_TABLE = (process.env.AWS_DYNAMODB_SESSIONS_TABLE || '').trim();
const DYNAMO_SESSIONS_FALLBACK_S3 = process.env.DYNAMO_SESSIONS_FALLBACK_S3 !== 'false';
const DYNAMO_ATTACH_LIST_IMAGES = process.env.DYNAMO_ATTACH_LIST_IMAGES !== 'false';
/** If objects live under a parent folder (e.g. prod/ or mobile-uploads/), set AWS_S3_BASE_PREFIX=prod */
const S3_BASE_PREFIX = (process.env.AWS_S3_BASE_PREFIX || '').trim();

/**
 * Portal-created training dataset roots live under this single segment inside the same bucket as readings
 * (not a separate AWS bucket — set IAM on this prefix). Override with AWS_S3_TRAINING_DATASETS_ROOT.
 */
const TRAINING_DATASETS_SEGMENT = (() => {
  let s = (process.env.AWS_S3_TRAINING_DATASETS_ROOT || 'training-datasets')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '');
  if (!s) s = 'training-datasets';
  return s;
})();

function getTrainingDatasetsRootPrefix() {
  return withS3Base(`${TRAINING_DATASETS_SEGMENT}/`);
}

function sanitizeDatasetSlug(displayName) {
  const base = String(displayName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'dataset';
}

const WORK_TYPES = ['1000', '2000', '3000', '4000', '5000'];

const WORK_TYPE_LABELS = {
  '1000': 'Meter Reading',
  '2000': 'GO95 Electrical Pole Inspection',
  '3000': 'Riser Inspection',
  '4000': 'Leak Inspection',
  '5000': 'Intrusive Inspection',
};

/**
 * Portal work-type codes (1000..5000) vs S3 first path segment.
 * iOS app uses short codes (METR, GO95, …); older uploads may use numeric folders only.
 * When listing readings for a portal work type, we scan every prefix listed here.
 */
const WORK_TYPE_S3_FOLDER_PREFIXES = {
  '1000': ['1000', 'METR'],
  '2000': ['2000', 'GO95'],
  '3000': ['3000', 'RISR'],
  '4000': ['4000', 'LEAK'],
  '5000': ['5000', 'INTR'],
};

function getS3FolderRootsForPortalWorkType(workType) {
  const roots = WORK_TYPE_S3_FOLDER_PREFIXES[workType];
  if (roots?.length) return [...new Set(roots)];
  return [workType];
}

/**
 * S3 session-folder layout (meter reading / work type 1000 is the main case):
 * - `f_` = field captures; `s_` = simulator or pre-taken images.
 * - Suffix = tagging outcome, e.g. `correct`, `incorrect`, `incorrect_analyzed`, …
 * - Paths are either at bucket root (`f_correct/…`, `s_incorrect/…`) or under the
 *   work-type prefix (`1000/f_correct/…`, `METR/s_correct/…` from iOS) for newer uploads. Optional env
 *   `AWS_S3_BASE_PREFIX` prepends one more parent segment if the whole tree lives
 *   under e.g. `prod/`.
 */
const STATUS_FOLDER_MAP = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
};

function withS3Base(relativePath) {
  const rel = relativePath.replace(/^\//, '');
  if (!S3_BASE_PREFIX) return rel;
  const base = S3_BASE_PREFIX.replace(/\/+$/, '');
  return `${base}/${rel}`;
}

/** Registry of manual training / model iterations (portal; S3 JSON). */
function pipelineIterationsS3Key() {
  return withS3Base('portal-admin/pipeline-iterations.json');
}

function cloneJsonObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

function normalizePipelineIterationRow(raw, fallbackId) {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId;
  const pipeline = String(raw?.pipeline ?? '').trim();
  const iterationNumber = parseInt(String(raw?.iterationNumber ?? raw?.iteration_number ?? ''), 10);
  const modelId = String(raw?.modelId ?? raw?.model_id ?? '').trim();
  const appVersion = String(raw?.appVersion ?? raw?.app_version ?? '').trim();
  const startDate = String(raw?.startDate ?? raw?.start_date ?? '').trim();
  const plannedEndDate = String(raw?.plannedEndDate ?? raw?.planned_end_date ?? '').trim();
  const scope = String(raw?.scope ?? '').trim();
  const imageCount = raw?.imageCount ?? raw?.image_count;
  const imagesAddedSinceLastIteration =
    raw?.imagesAddedSinceLastIteration ?? raw?.images_added_since_last_iteration;
  const currentStatus = String(raw?.currentStatus ?? raw?.current_status ?? '').trim();
  const subStatus = String(raw?.subStatus ?? raw?.sub_status ?? '').trim();
  const readyToTestSimulatorSubStatus = String(
    raw?.readyToTestSimulatorSubStatus ?? raw?.ready_to_test_simulator_sub_status ?? '',
  ).trim();
  const readyToTestUnitTestSubStatus = String(
    raw?.readyToTestUnitTestSubStatus ?? raw?.ready_to_test_unit_test_sub_status ?? '',
  ).trim();
  const outcome = String(raw?.outcome ?? '').trim();

  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id,
    pipeline,
    iterationNumber: Number.isFinite(iterationNumber) ? iterationNumber : NaN,
    modelId,
    appVersion,
    startDate,
    plannedEndDate,
    scope,
    imageCount: numOrNull(imageCount),
    imagesAddedSinceLastIteration: numOrNull(imagesAddedSinceLastIteration),
    currentStatus,
    subStatus,
    readyToTestSimulatorSubStatus,
    readyToTestUnitTestSubStatus,
    outcome,
    portalStats: cloneJsonObject(raw?.portalStats ?? raw?.portal_stats),
    manualMetrics: cloneJsonObject(raw?.manualMetrics ?? raw?.manual_metrics),
    linkedUnitTests: normalizePipelineIterationUnitTestLinks(raw),
    linkedTrainingDatasets: normalizePipelineIterationTrainingDatasetLinks(raw),
    factoryStage: String(raw?.factoryStage ?? raw?.factory_stage ?? '').trim() || null,
    factoryStageSubStatus: String(
      raw?.factoryStageSubStatus ?? raw?.factory_stage_sub_status ?? '',
    ).trim(),
    modelShip: normalizePipelineIterationModelShip(raw?.modelShip ?? raw?.model_ship),
    roboflowLinks: normalizePipelineIterationRoboflowLinks(raw?.roboflowLinks ?? raw?.roboflow_links),
    modelWeights: normalizePipelineIterationModelWeights(raw?.modelWeights ?? raw?.model_weights),
    updatedAt: String(raw?.updatedAt ?? raw?.updated_at ?? '').trim() || null,
  };
}

function iterationRowContentFingerprint(row) {
  if (!row || typeof row !== 'object') return '';
  const { updatedAt: _u, ...rest } = row;
  try {
    return JSON.stringify(rest);
  } catch {
    return '';
  }
}

function sanitizePipelineIterationId(id) {
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, 120);
}

/** Work type segment for iteration weights (default meter reading). */
const WEIGHTS_S3_WORK_TYPE = String(process.env.WEIGHTS_S3_WORK_TYPE || '1000').trim() || '1000';

function sanitizeIterationWeightsFolderName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function buildIterationWeightsFolderName(row) {
  const pipeline = String(row?.pipeline ?? 'iteration').trim() || 'iteration';
  const n = parseInt(String(row?.iterationNumber ?? ''), 10);
  const iter = Number.isFinite(n) ? n : 0;
  let name = `${pipeline}-iter-${iter}`;
  const model = String(row?.modelId ?? '').trim();
  if (model) name += `_${model}`;
  return sanitizeIterationWeightsFolderName(name);
}

function iterationWeightFileName(role) {
  return role === 'dial_detection' ? 'dial_detection.pt' : 'weights.pt';
}

function iterationWeightS3Key(folderName, role) {
  const safe = sanitizeIterationWeightsFolderName(folderName);
  if (!safe) return null;
  return withS3Base(`${WEIGHTS_S3_WORK_TYPE}/Weights/${safe}/${iterationWeightFileName(role)}`);
}

async function readPipelineIterationsDoc() {
  const key = pipelineIterationsS3Key();
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    const txt = await streamToString(out.Body);
    return JSON.parse(txt);
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return { iterations: [] };
    }
    throw e;
  }
}

async function resolveIterationWeightsFolder(iterationId, hints = {}) {
  const fromHint = hints.iterationFolder ?? hints.iterationName;
  if (fromHint) return sanitizeIterationWeightsFolderName(fromHint);

  try {
    const doc = await readPipelineIterationsDoc();
    const row = (Array.isArray(doc.iterations) ? doc.iterations : []).find(
      (r) => r && String(r.id) === String(iterationId),
    );
    if (row) return buildIterationWeightsFolderName(row);
  } catch {
    /* fall through */
  }

  if (hints.pipeline != null || hints.iterationNumber != null || hints.modelId) {
    return buildIterationWeightsFolderName(hints);
  }

  return sanitizeIterationWeightsFolderName(sanitizePipelineIterationId(iterationId));
}

function normalizePipelineIterationModelWeights(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normOne = (v) => {
    if (!v || typeof v !== 'object') return null;
    const s3Key = String(v.s3Key ?? v.s3_key ?? '').trim();
    if (!s3Key || s3Key.includes('..')) return null;
    const sizeBytes = v.sizeBytes ?? v.size_bytes;
    const n = typeof sizeBytes === 'number' ? sizeBytes : parseInt(String(sizeBytes ?? ''), 10);
    return {
      s3Key,
      bucket: String(v.bucket ?? BUCKET_NAME).trim() || BUCKET_NAME,
      uploadedAt: String(v.uploadedAt ?? v.uploaded_at ?? '').trim() || null,
      sizeBytes: Number.isFinite(n) ? n : null,
      originalFileName: String(v.originalFileName ?? v.original_file_name ?? '').trim() || null,
      source: v.source === 'roboflow' || v.source === 'upload' ? v.source : null,
      roboflowFormat: String(v.roboflowFormat ?? v.roboflow_format ?? '').trim() || null,
      weightsFolder: String(v.weightsFolder ?? v.weights_folder ?? '').trim() || null,
      weightsPrefix: String(v.weightsPrefix ?? v.weights_prefix ?? '').trim() || null,
    };
  };
  const dial = normOne(raw.dialDetection ?? raw.dial_detection);
  const keypoint = normOne(raw.keypoint);
  if (!dial && !keypoint) return null;
  return { dialDetection: dial, keypoint };
}

async function putPipelineIterationWeightBuffer(iterationId, role, buffer, meta = {}) {
  const folderName = await resolveIterationWeightsFolder(iterationId, meta);
  const key = iterationWeightS3Key(folderName, role);
  if (!key) throw new Error('Invalid iteration folder name.');
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }),
  );
  const uploadedAt = new Date().toISOString();
  return {
    s3Key: key,
    bucket: BUCKET_NAME,
    uploadedAt,
    sizeBytes: buffer.length,
    originalFileName:
      String(meta.originalFileName || '').trim() || iterationWeightFileName(role),
    source: meta.source === 'roboflow' ? 'roboflow' : 'upload',
    roboflowFormat: meta.roboflowFormat ? String(meta.roboflowFormat).trim() : null,
    weightsFolder: folderName,
    weightsPrefix: `${WEIGHTS_S3_WORK_TYPE}/Weights/${folderName}/`,
  };
}

function parseIterationWeightRole(raw) {
  const r = String(raw ?? '').trim();
  if (r === 'dial_detection' || r === 'dialDetection') return 'dial_detection';
  if (r === 'keypoint') return 'keypoint';
  return null;
}

function normalizePipelineIterationModelShip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dial = raw.dialDetection ?? raw.dial_detection;
  const keypoint = raw.keypoint;
  if (dial == null && keypoint == null) return null;
  return {
    dialDetection: dial === true,
    keypoint: keypoint === true,
    dialDetectionSubStatus: String(
      raw.dialDetectionSubStatus ?? raw.dial_detection_sub_status ?? '',
    ).trim(),
    keypointSubStatus: String(raw.keypointSubStatus ?? raw.keypoint_sub_status ?? '').trim(),
  };
}

function pipelineNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function pipelineFloatOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function normalizeRoboflowSplits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const train = raw.train;
  const valid = raw.valid ?? raw.validation;
  const test = raw.test;
  const n = (v) => {
    if (v == null || v === '') return null;
    const x = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(x) ? x : null;
  };
  const out = { train: n(train), valid: n(valid), test: n(test) };
  if (out.train == null && out.valid == null && out.test == null) return null;
  return out;
}

function normalizePipelineIterationRoboflowLinks(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normLink = (v) => {
    if (!v || typeof v !== 'object') return null;
    const datasetSlug = String(v.datasetSlug ?? v.dataset_slug ?? '').trim();
    if (!datasetSlug) return null;
    const ver = v.version ?? v.version_number;
    return {
      datasetSlug,
      projectName: String(v.projectName ?? v.project_name ?? '').trim() || null,
      version: ver === null || ver === undefined || ver === '' ? null : parseInt(String(ver), 10) || null,
      role: v.role === 'dial_detection' || v.role === 'keypoint' ? v.role : null,
      modelTypeDisplay:
        String(v.modelTypeDisplay ?? v.model_type_display ?? '').trim() || null,
      versionName: String(v.versionName ?? v.version_name ?? '').trim() || null,
      imageCount: pipelineNumOrNull(v.imageCount ?? v.image_count),
      splits: normalizeRoboflowSplits(v.splits),
      versionCreatedAt: String(v.versionCreatedAt ?? v.version_created_at ?? '').trim() || null,
      lastTrainedAt: String(v.lastTrainedAt ?? v.last_trained_at ?? '').trim() || null,
      trainStatus: String(v.trainStatus ?? v.train_status ?? '').trim() || null,
      mapPercent: pipelineFloatOrNull(v.mapPercent ?? v.map_percent),
      precisionPercent: pipelineFloatOrNull(v.precisionPercent ?? v.precision_percent),
      recallPercent: pipelineFloatOrNull(v.recallPercent ?? v.recall_percent),
      checkpoint: String(v.checkpoint ?? '').trim() || null,
      modelId: String(v.modelId ?? v.model_id ?? '').trim() || null,
    };
  };
  const dial = normLink(raw.dialDetection ?? raw.dial_detection);
  const keypoint = normLink(raw.keypoint);
  if (!dial && !keypoint) return null;
  return { dialDetection: dial, keypoint };
}

function normalizePipelineIterationUnitTestLinks(raw) {
  const fromArray = raw?.linkedUnitTests ?? raw?.linked_unit_tests;
  if (Array.isArray(fromArray)) {
    const out = [];
    for (const item of fromArray) {
      if (!item || typeof item !== 'object') continue;
      const s3Key = String(item.s3Key ?? item.s3_key ?? '').trim();
      if (!s3Key || s3Key.includes('..')) continue;
      const acc = item.accuracyPercent ?? item.accuracy_percent;
      const imgs = item.imagesProcessed ?? item.images_processed;
      out.push({
        s3Key,
        fileName: String(item.fileName ?? item.file_name ?? s3Key.split('/').pop() ?? '').trim() || null,
        linkedAt: String(item.linkedAt ?? item.linked_at ?? '').trim() || null,
        pipelineId: String(item.pipelineId ?? item.pipeline_id ?? '').trim() || null,
        pipelineDisplayName:
          String(item.pipelineDisplayName ?? item.pipeline_display_name ?? '').trim() || null,
        accuracyPercent:
          acc === null || acc === undefined || acc === ''
            ? null
            : Number.isFinite(Number(acc))
              ? Number(acc)
              : null,
        imagesProcessed:
          imgs === null || imgs === undefined || imgs === ''
            ? null
            : Number.isFinite(Number(imgs))
              ? Number(imgs)
              : null,
        generatedUtc: String(item.generatedUtc ?? item.generated_utc ?? '').trim() || null,
        appVersionHint: String(item.appVersionHint ?? item.app_version_hint ?? '').trim() || null,
      });
    }
    return out;
  }
  const legacyKeys = raw?.linkedUnitTestS3Keys ?? raw?.linked_unit_test_s3_keys;
  if (!Array.isArray(legacyKeys)) return [];
  return legacyKeys
    .map((k) => String(k ?? '').trim())
    .filter((s3Key) => s3Key && !s3Key.includes('..'))
    .map((s3Key) => ({
      s3Key,
      fileName: s3Key.split('/').pop() || null,
      linkedAt: null,
      pipelineId: null,
      pipelineDisplayName: null,
      accuracyPercent: null,
      imagesProcessed: null,
      generatedUtc: null,
      appVersionHint: null,
    }));
}

function validatePipelineIterationsPayload(iterations) {
  if (!Array.isArray(iterations)) return 'iterations must be an array';
  const seen = new Set();
  for (let i = 0; i < iterations.length; i++) {
    const row = iterations[i];
    if (!row || typeof row !== 'object') return `iterations[${i}]: invalid row`;
    if (!row.pipeline?.trim()) return `iterations[${i}]: pipeline is required`;
    if (!Number.isFinite(row.iterationNumber) || row.iterationNumber < 1) {
      return `iterations[${i}]: iterationNumber must be a positive integer`;
    }
    if (!row.startDate?.trim()) return `iterations[${i}]: startDate is required`;
    const dedupe = `${row.pipeline.trim().toLowerCase()}\t${row.iterationNumber}`;
    if (seen.has(dedupe)) {
      return `Duplicate pipeline + iteration # (${row.pipeline} / ${row.iterationNumber})`;
    }
    seen.add(dedupe);
  }
  return null;
}

function getFolderForStatus(sourceType, status, workType = null) {
  const prefix = sourceType === 'field' ? 'f_' : 's_';
  const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';

  if (workType && workType !== '1000') {
    return withS3Base(`${workType}/${prefix}${suffix}/`);
  }
  return withS3Base(`${prefix}${suffix}/`);
}

// Build the full list of folder prefixes to scan for a given source/workType
function getAllFolderPrefixes(source, workType) {
  const prefixes = [];
  const sources = source === 'all' ? ['field', 'simulator'] : [source];

  // Explicit work-type roots: e.g. 1000 + METR for meter reading (iOS + legacy)
  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    for (const src of sources) {
      for (const status of ALL_STATUSES) {
        const srcPrefix = src === 'field' ? 'f_' : 's_';
        const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
        prefixes.push({
          folder: withS3Base(`${root}/${srcPrefix}${suffix}/`),
          status,
          sourceType: src,
        });
      }
    }
  }

  // Meter reading only: legacy sessions at bucket root (no work-type folder)
  if (workType === '1000') {
    for (const src of sources) {
      for (const status of ALL_STATUSES) {
        const folder = getFolderForStatus(src, status, '1000');
        prefixes.push({ folder, status, sourceType: src });
      }
    }
    if (source === 'all' || source === 'field') {
      prefixes.push({ folder: withS3Base('correct/'), status: 'correct', sourceType: 'field' });
      prefixes.push({ folder: withS3Base('incorrect/'), status: 'incorrect_new', sourceType: 'field' });
    }
  }

  // iOS default upload: `{workType}/f_skipped_review/` (is_manually_reviewed=false)
  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    for (const src of sources) {
      const srcPrefix = src === 'field' ? 'f_' : 's_';
      prefixes.push({
        folder: withS3Base(`${root}/${srcPrefix}skipped_review/`),
        status: 'incorrect_new',
        sourceType: src,
      });
    }
  }

  // Portal manual uploads: `{workType}/manually_uploaded/{sessionId}/`
  for (const root of getS3FolderRootsForPortalWorkType(workType)) {
    prefixes.push({
      folder: withS3Base(`${root}/manually_uploaded/`),
      status: 'manually_uploaded',
      sourceType: 'simulator',
    });
  }

  const seen = new Set();
  return prefixes.filter((p) => {
    if (seen.has(p.folder)) return false;
    seen.add(p.folder);
    return true;
  });
}

if (!process.env.AWS_PROFILE && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)) {
  console.warn('⚠️  AWS credentials not set — configure AWS_PROFILE or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.');
}

const s3Client = new S3Client({
  region: REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

const sessionIndex = createSessionIndexStore({
  tableName: DYNAMO_SESSIONS_TABLE,
  region: REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

if (sessionIndex.enabled) {
  console.log(`📇 DynamoDB session index enabled (${sessionIndex.tableName})`);
} else {
  console.log('📇 DynamoDB session index disabled — set AWS_DYNAMODB_SESSIONS_TABLE to enable');
}

// --- Stale-while-revalidate caches (fast UX, background refresh, invalidate on writes) ---
const SESSION_CACHE_FRESH_MS = parseCacheMs(process.env.API_CACHE_FRESH_MS, 8000);
const SESSION_CACHE_STALE_MAX_MS = parseCacheMs(process.env.API_CACHE_STALE_MAX_MS, 45000);
const UNIT_TEST_CACHE_FRESH_MS = parseCacheMs(process.env.UNIT_TEST_RUNS_CACHE_TTL_MS, 30000);
const UNIT_TEST_CACHE_STALE_MAX_MS = parseCacheMs(process.env.UNIT_TEST_RUNS_STALE_MAX_MS, 120000);
const UNIT_TEST_SUMMARY_DEFAULT_LIMIT = Math.max(
  1,
  parseInt(process.env.UNIT_TEST_SUMMARY_DEFAULT_LIMIT || '50', 10) || 50,
);

const sessionCache = createResponseCache({
  name: 'sessions',
  freshMs: SESSION_CACHE_FRESH_MS,
  staleMaxMs: SESSION_CACHE_STALE_MAX_MS,
});
const unitTestRunsCache = createResponseCache({
  name: 'unit-test-runs',
  freshMs: UNIT_TEST_CACHE_FRESH_MS,
  staleMaxMs: UNIT_TEST_CACHE_STALE_MAX_MS,
});

function getCacheKey(source, workType) {
  return `${source}:${workType}`;
}

function invalidateCache() {
  sessionCache.invalidate();
  unitTestRunsCache.invalidate();
}

/** Drop cached readings/counts/light/uploaded-today for one portal work type. */
function invalidateReadingsCache(source = 'all', workType = '1000') {
  const sources = source === 'all' ? ['all', 'field', 'simulator'] : [source, 'all'];
  const workTypes = workType && WORK_TYPES.includes(workType) ? [workType] : WORK_TYPES;
  for (const s of sources) {
    for (const wt of workTypes) {
      sessionCache.invalidate(getCacheKey(s, wt));
      sessionCache.invalidate(`counts:${s}:${wt}`);
      sessionCache.invalidate(`light:${s}:${wt}`);
      sessionCache.invalidateMatching(`uploadedToday:${s}:${wt}:`);
    }
  }
}

const FOLDER_SUFFIX_TO_STATUS = {
  correct: 'correct',
  incorrect: 'incorrect_new',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  no_dials: 'no_dials',
  not_sure: 'not_sure',
  skipped_review: 'incorrect_new',
};

function inferStatusAndSourceFromSessionPrefix(prefix) {
  const norm = normalizeS3SessionPrefix(prefix);
  const parts = norm.split('/').filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i];
    if (seg === 'manually_uploaded') {
      return { status: 'manually_uploaded', sourceType: 'simulator' };
    }
    if (seg === 'correct') return { status: 'correct', sourceType: 'field' };
    if (seg === 'incorrect') return { status: 'incorrect_new', sourceType: 'field' };
    if (seg.startsWith('f_')) {
      const suffix = seg.slice(2);
      return {
        status: FOLDER_SUFFIX_TO_STATUS[suffix] || 'incorrect_new',
        sourceType: 'field',
      };
    }
    if (seg.startsWith('s_')) {
      const suffix = seg.slice(2);
      return {
        status: FOLDER_SUFFIX_TO_STATUS[suffix] || 'incorrect_new',
        sourceType: 'simulator',
      };
    }
  }
  return { status: 'incorrect_new', sourceType: 'field' };
}

async function parseSessionAtPrefix(s3SessionPrefix, workTypeHint = '1000') {
  const norm = normalizeS3SessionPrefix(s3SessionPrefix);
  if (!norm) return null;
  const { status, sourceType } = inferStatusAndSourceFromSessionPrefix(norm);
  return parseSession(norm, status, sourceType, workTypeHint || '1000');
}

/** When the same session_id appears under multiple S3 prefixes, prefer test-queue / library markers and newest portal update. */
function readingDuplicatePriority(r) {
  let score = 0;
  if (r.reviewerDatasetDestination === 'test') score += 4;
  if (r.testDataReviewStatus === 'approved') score += 8;
  if (r.testDataReviewStatus === 'pending') score += 2;
  if (r.testDataUnitTestS3Key) score += 8;
  const t = Date.parse(r.portalMetadataUpdatedAt || r.dateOfReading || '');
  return { score, time: Number.isFinite(t) ? t : 0 };
}

function pickPreferredReadingDuplicate(a, b) {
  const pa = readingDuplicatePriority(a);
  const pb = readingDuplicatePriority(b);
  if (pa.score !== pb.score) return pa.score > pb.score ? a : b;
  return pa.time >= pb.time ? a : b;
}

/** Fire-and-forget improvement index updates (does not block API responses). */
function scheduleImprovementUpdate(fn) {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error('📈 improvement analytics update:', err.message));
  });
}

function syncImprovementFromReading(source, workType, reading) {
  if (!improvementAnalytics || !reading) return;
  scheduleImprovementUpdate(() =>
    improvementAnalytics.upsertFromReading(source || 'all', workType || '1000', reading),
  );
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const improvementAnalytics = createImprovementAnalyticsStore({
  s3Client,
  bucketName: ANALYTICS_BUCKET_NAME,
  keyPrefix: ANALYTICS_KEY_PREFIX,
  fallbackBucketName: ANALYTICS_FALLBACK_BUCKET,
  fallbackKeyPrefix: 'analytics',
  region: REGION,
  allowCreateBucket: ANALYTICS_USE_DEDICATED_BUCKET,
  streamToString,
});

/** Full S3 object body as Buffer — required before archiver.append; piping SDK streams often corrupts ZIPs. */
async function streamToBuffer(stream) {
  if (!stream) return null;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getSignedImageUrl(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/** Align per-dial `prediction` with `ml_prediction` when flat rows are stale (e.g. all zeros). */
function normalizeDialDetailsFromMetadata(dialDetails, mlPrediction, userCorrection) {
  if (!Array.isArray(dialDetails) || dialDetails.length === 0) return dialDetails;
  const mv = String(mlPrediction ?? '').replace(/\D/g, '');
  const exp = String(userCorrection ?? '').replace(/\D/g, '');

  const normalized = dialDetails.map((d, i) => {
    if (!d || typeof d !== 'object') return d;
    const c = normalizeSessionConfidenceValue(d.confidence);
    const dialNum = Number.isInteger(d.dial) && d.dial >= 1 ? d.dial : i + 1;
    let prediction = d.prediction;
    if (!Number.isFinite(Number(prediction)) || prediction < 0 || prediction > 9) {
      const stageDigit = d.stage_3?.digit;
      if (stageDigit != null && Number.isFinite(Number(stageDigit))) prediction = Number(stageDigit);
    }
    let digit = Number.isFinite(Number(prediction)) ? Math.round(Number(prediction)) : 0;
    digit = ((digit % 10) + 10) % 10;
    return {
      ...d,
      dial: dialNum,
      prediction: digit,
      ...(c !== undefined ? { confidence: c } : {}),
    };
  });

  if (!mv && !exp) return normalized;

  const fromRows = [...normalized]
    .sort((a, b) => a.dial - b.dial)
    .map((r) => String(r.prediction))
    .join('');
  if (exp && fromRows === exp) return normalized;
  if (mv && fromRows === mv) return normalized;

  const alignTo = mv || exp;
  if (!alignTo) return normalized;

  return normalized.map((row, i) => {
    const dialNum = row.dial >= 1 ? row.dial : i + 1;
    const ch = alignTo[dialNum - 1];
    if (ch && /\d/.test(ch)) {
      return { ...row, prediction: parseInt(ch, 10) };
    }
    return row;
  });
}

/** Coerce metadata confidence to 0–1; supports numeric strings and 1–100 percentages. */
function normalizeSessionConfidenceValue(raw) {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  if (n > 1 && n <= 100) return n / 100;
  if (n >= 0 && n <= 1) return n;
  return undefined;
}

/** Normalize iOS `metadata.capture_location` for API consumers. */
function normalizeCaptureLocation(metadata) {
  const loc = metadata?.capture_location;
  if (!loc || typeof loc !== 'object') return null;
  const latitude = typeof loc.latitude === 'number' && Number.isFinite(loc.latitude) ? loc.latitude : null;
  const longitude = typeof loc.longitude === 'number' && Number.isFinite(loc.longitude) ? loc.longitude : null;
  const placeLabel = typeof loc.place_label === 'string' ? loc.place_label.trim() || null : null;
  const coordinateLabel =
    typeof loc.coordinate_label === 'string' ? loc.coordinate_label.trim() || null : null;
  const accuracyM =
    typeof loc.accuracy_m === 'number' && Number.isFinite(loc.accuracy_m) ? loc.accuracy_m : null;
  const capturedAt = typeof loc.captured_at === 'string' ? loc.captured_at.trim() || null : null;
  if (!placeLabel && !coordinateLabel && latitude == null && longitude == null) return null;
  return { placeLabel, coordinateLabel, latitude, longitude, accuracyM, capturedAt };
}

/** Normalize iOS `metadata.capture_device_tilt` for API consumers. */
function normalizeCaptureDeviceTilt(metadata) {
  const tilt = metadata?.capture_device_tilt;
  if (!tilt || typeof tilt !== 'object') return null;
  const rollDeg = typeof tilt.roll_deg === 'number' && Number.isFinite(tilt.roll_deg) ? tilt.roll_deg : null;
  const pitchDeg = typeof tilt.pitch_deg === 'number' && Number.isFinite(tilt.pitch_deg) ? tilt.pitch_deg : null;
  const levelDotOffsetXNorm =
    typeof tilt.level_dot_offset_x_norm === 'number' && Number.isFinite(tilt.level_dot_offset_x_norm)
      ? tilt.level_dot_offset_x_norm
      : null;
  const levelDotOffsetYNorm =
    typeof tilt.level_dot_offset_y_norm === 'number' && Number.isFinite(tilt.level_dot_offset_y_norm)
      ? tilt.level_dot_offset_y_norm
      : null;
  const isLevel = tilt.is_level === true ? true : tilt.is_level === false ? false : null;
  const capturedAt = typeof tilt.captured_at === 'string' ? tilt.captured_at.trim() || null : null;
  if (rollDeg == null && pitchDeg == null && isLevel == null) return null;
  return { rollDeg, pitchDeg, levelDotOffsetXNorm, levelDotOffsetYNorm, isLevel, capturedAt };
}

/** Normalize iOS `metadata.capture_compass` for API consumers. */
function normalizeCaptureCompass(metadata) {
  const compass = metadata?.capture_compass;
  if (!compass || typeof compass !== 'object') return null;
  const cameraHeadingDeg =
    typeof compass.camera_heading_deg === 'number' && Number.isFinite(compass.camera_heading_deg)
      ? compass.camera_heading_deg
      : null;
  const cameraFacing = typeof compass.camera_facing === 'string' ? compass.camera_facing.trim() || null : null;
  const meterFacingDeg =
    typeof compass.meter_facing_deg === 'number' && Number.isFinite(compass.meter_facing_deg)
      ? compass.meter_facing_deg
      : null;
  const meterFacing = typeof compass.meter_facing === 'string' ? compass.meter_facing.trim() || null : null;
  const headingAccuracyDeg =
    typeof compass.heading_accuracy_deg === 'number' && Number.isFinite(compass.heading_accuracy_deg)
      ? compass.heading_accuracy_deg
      : null;
  const capturedAt = typeof compass.captured_at === 'string' ? compass.captured_at.trim() || null : null;
  if (cameraHeadingDeg == null && !cameraFacing && meterFacingDeg == null && !meterFacing) return null;
  return { cameraHeadingDeg, cameraFacing, meterFacingDeg, meterFacing, headingAccuracyDeg, capturedAt };
}

/** Short list label: place name or coordinates (not field vs simulator). */
function formatCaptureLocationFromMetadata(metadata) {
  const loc = normalizeCaptureLocation(metadata);
  if (!loc) return null;
  if (loc.placeLabel) return loc.placeLabel;
  if (loc.coordinateLabel) return loc.coordinateLabel;
  if (loc.latitude != null && loc.longitude != null) {
    const latH = loc.latitude >= 0 ? 'N' : 'S';
    const lonH = loc.longitude >= 0 ? 'E' : 'W';
    return `${Math.abs(loc.latitude).toFixed(5)}° ${latH}, ${Math.abs(loc.longitude).toFixed(5)}° ${lonH}`;
  }
  return null;
}

async function parseSession(prefix, status, sourceType, workType = 'ANALOG_METER') {
  try {
    const metadataCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${prefix}metadata.json`,
    });
    
    const [metadataResponse, listResponse] = await Promise.all([
      s3Client.send(metadataCommand),
      s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix })),
    ]);

    const metadataJson = await streamToString(metadataResponse.Body);
    const metadata = JSON.parse(metadataJson);
    
    const files = listResponse.Contents || [];
    
    const imageFiles = files.filter(f =>
      f.Key.endsWith('.jpg') || f.Key.endsWith('.jpeg') || f.Key.endsWith('.png')
    );

    const signedUrls = await Promise.all(
      imageFiles.map(f => getSignedImageUrl(f.Key))
    );

    const images = imageFiles.map((file, i) => {
      const fileName = file.Key.split('/').pop();
      let label = 'Image';
      if (fileName === 'original.jpg') {
        label = 'Guided crop';
      } else if (fileName === 'full_meter.jpg') {
        label = 'Full meter';
      } else if (fileName.startsWith('dial_')) {
        const dialNum = fileName.match(/dial_(\d+)/)?.[1] || '?';
        label = `Dial ${dialNum}`;
      }
      
      return {
        id: file.Key,
        url: signedUrls[i],
        label,
        fileName,
        metadata: {
          capturedAt: metadata.timestamp,
          resolution: fileName === 'original.jpg' ? '4032x3024' : '224x224',
          fileSize: `${Math.round((file.Size || 0) / 1024)} KB`,
          dialIndex: fileName.startsWith('dial_') ? parseInt(fileName.match(/dial_(\d+)/)?.[1] || '0') - 1 : undefined,
        },
      };
    });
    
    images.sort((a, b) => {
      const rank = (fileName) => {
        if (fileName === 'original.jpg') return 0;
        if (fileName === 'full_meter.jpg') return 1;
        return 2;
      };
      const diff = rank(a.fileName) - rank(b.fileName);
      if (diff !== 0) return diff;
      return a.fileName.localeCompare(b.fileName);
    });

    const portalManualReview = portalManualReviewFromMetadata(metadata);
    
    return {
      id: metadata.session_id,
      /** Full S3 prefix for this session (trailing slash). Used for status moves. */
      s3SessionPrefix: prefix,
      dateOfReading: metadata.timestamp,
      location: formatCaptureLocationFromMetadata(metadata) || 'Location unavailable',
      captureLocation: normalizeCaptureLocation(metadata),
      captureDeviceTilt: normalizeCaptureDeviceTilt(metadata),
      captureCompass: normalizeCaptureCompass(metadata),
      type:
        metadata.upload_mode === 'field'
          ? 'field'
          : metadata.upload_mode === 'simulator'
            ? 'simulator'
            : sourceType,
      status,
      workType: metadata.work_type || workType,
      meterValue: metadata.ml_prediction,
      expectedValue: metadata.user_correction || undefined,
      rawPrediction: metadata.ml_raw_prediction,
      isCorrect: metadata.is_correct,
      confidence: normalizeSessionConfidenceValue(metadata.confidence),
      processingTimeMs: metadata.processing_time_ms,
      dialCount: metadata.dial_count,
      dialDetails: normalizeDialDetailsFromMetadata(
        metadata.dial_details,
        metadata.ml_prediction,
        metadata.user_correction,
      ),
      conditionCode: metadata.condition_code,
      userName: metadata.user_name || metadata.user_email || '',
      imageSource: metadata.image_source || '',
      uploadMode: metadata.upload_mode || '',
      feedbackType: metadata.feedback_type || '',
      /** iOS `AppConfig.appVersion` — use to compare on-device model generations. */
      appVersion: metadata.app_version != null ? String(metadata.app_version) : '',
      reviewerRecommendTraining:
        metadata.reviewer_dataset_destination === 'training' ||
        (metadata.reviewer_dataset_destination == null && metadata.reviewer_recommend_training === true),
      reviewerDatasetDestination:
        metadata.reviewer_dataset_destination === 'training' || metadata.reviewer_dataset_destination === 'test'
          ? metadata.reviewer_dataset_destination
          : metadata.reviewer_recommend_training === true
            ? 'training'
            : null,
      imageDifficulty:
        metadata.image_difficulty === 'normal' ||
        metadata.image_difficulty === 'difficult' ||
        metadata.image_difficulty === 'very_difficult'
          ? metadata.image_difficulty
          : null,
      testDataReviewStatus:
        metadata.test_data_review_status === 'approved' || metadata.test_data_review_status === 'pending'
          ? metadata.test_data_review_status
          : metadata.reviewer_dataset_destination === 'test' && metadata.test_data_review_status !== 'approved'
            ? 'pending'
            : null,
      testDataUnitTestS3Key:
        typeof metadata.test_data_unit_test_s3_key === 'string' ? metadata.test_data_unit_test_s3_key : undefined,
      testDataUnitTestFileName:
        typeof metadata.test_data_unit_test_file_name === 'string' ? metadata.test_data_unit_test_file_name : undefined,
      testDataApprovedAt:
        typeof metadata.test_data_approved_at === 'string' ? metadata.test_data_approved_at : undefined,
      testDataSubmittedAt:
        typeof metadata.test_data_submitted_at === 'string' ? metadata.test_data_submitted_at : undefined,
      testDataSubmittedBy:
        typeof metadata.test_data_submitted_by === 'string' && metadata.test_data_submitted_by.trim() !== ''
          ? String(metadata.test_data_submitted_by).trim().slice(0, 320)
          : undefined,
      /** Portal / iOS: `is_manually_reviewed` in metadata.json (legacy `is_human_reviewed` still honored when reading). */
      isManuallyReviewed:
        metadata.is_manually_reviewed === true || metadata.is_human_reviewed === true,
      portalMetadataUpdatedBy:
        typeof metadata.portal_metadata_updated_by === 'string' && metadata.portal_metadata_updated_by.trim() !== ''
          ? String(metadata.portal_metadata_updated_by).trim().slice(0, 320)
          : undefined,
      portalMetadataUpdatedAt:
        typeof metadata.portal_metadata_updated_at === 'string' && metadata.portal_metadata_updated_at.trim() !== ''
          ? String(metadata.portal_metadata_updated_at).trim()
          : undefined,
      readsCorrectedCount: inferReadsCorrectedFromMetadata(metadata),
      hadUserCorrection: inferReadsCorrectedFromMetadata(metadata) > 0,
      portalManualReviewStatus: portalManualReview.portal_manual_review_status,
      portalManualReviewedBy: portalManualReview.portal_manual_reviewed_by ?? undefined,
      portalManualReviewedAt: portalManualReview.portal_manual_reviewed_at ?? undefined,
      portalManualReviewNotes: portalManualReview.portal_manual_review_notes ?? undefined,
      manualLabelPending:
        metadata.manual_label_pending === true ||
        (metadata.upload_source === 'portal_manual' &&
          !String(metadata.user_correction ?? '')
            .replace(/\D/g, '')
            .match(/^\d{4}$/)),
      comments:
        metadata.portal_review_notes != null && metadata.portal_review_notes !== ''
          ? String(metadata.portal_review_notes)
          : '',
      images,
      createdAt: metadata.timestamp,
      updatedAt: metadata.portal_metadata_updated_at || metadata.timestamp,
    };
  } catch (error) {
    console.error(`Error parsing session ${prefix}:`, error.message);
    return null;
  }
}

/** Metadata + image count only — no presigned URLs (used for improvement analytics index). */
async function parseSessionLight(prefix, status, sourceType, workType = '1000') {
  try {
    const metaKey = `${prefix}metadata.json`;
    const [metadataResponse, listResponse] = await Promise.all([
      s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey })),
      s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix })),
    ]);

    const metadata = JSON.parse(await streamToString(metadataResponse.Body));
    const files = listResponse.Contents || [];
    const imageCount = files.filter(
      (f) => f.Key.endsWith('.jpg') || f.Key.endsWith('.jpeg') || f.Key.endsWith('.png'),
    ).length;

    return {
      id: metadata.session_id,
      s3SessionPrefix: prefix,
      dateOfReading: metadata.timestamp,
      type: sourceType,
      status,
      workType: metadata.work_type || workType,
      meterValue: metadata.ml_prediction,
      expectedValue: metadata.user_correction || undefined,
      confidence: normalizeSessionConfidenceValue(metadata.confidence),
      dialDetails: normalizeDialDetailsFromMetadata(
        metadata.dial_details,
        metadata.ml_prediction,
        metadata.user_correction,
      ),
      appVersion: metadata.app_version != null ? String(metadata.app_version) : '',
      imageCount,
    };
  } catch (error) {
    console.error(`Error parsing session (light) ${prefix}:`, error.message);
    return null;
  }
}

async function getReadingsFromFolderLight(folderPrefix, status, sourceType, workType = '1000') {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: folderPrefix,
      Delimiter: '/',
    });

    const response = await s3Client.send(command);
    const folders = response.CommonPrefixes || [];

    const results = await Promise.all(
      folders.map((folder) => parseSessionLight(folder.Prefix, status, sourceType, workType)),
    );

    return results.filter(Boolean);
  } catch (error) {
    console.error(`Error listing folder (light) ${folderPrefix}:`, error.message);
    return [];
  }
}

async function getAllLightReadings(source = 'all', workType = '1000') {
  if (sessionIndex.enabled) {
    try {
      console.log(`\n📇 Light readings from Dynamo (source: ${source}, workType: ${workType})`);
      const unique = await getAllLightReadingsFromDynamo(source, workType);
      console.log(`📈 Light readings (Dynamo): ${unique.length} sessions\n`);
      return unique;
    } catch (err) {
      console.error('📇 Dynamo getAllLightReadings failed:', err.message);
      if (!DYNAMO_SESSIONS_FALLBACK_S3) throw err;
    }
  }

  console.log(`\n📈 Light readings scan for analytics (source: ${source}, workType: ${workType})`);
  const allPrefixes = getAllFolderPrefixes(source, workType);
  const readings = [];
  for (const { folder, status, sourceType } of allPrefixes) {
    const part = await getReadingsFromFolderLight(folder, status, sourceType, workType);
    readings.push(...part);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const seen = new Set();
  const unique = readings.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  console.log(`📈 Light readings: ${unique.length} sessions\n`);
  return unique;
}

async function getAllLightReadingsCached(source = 'all', workType = '1000', { force = false } = {}) {
  const cacheKey = `light:${source}:${workType}`;
  const { data } = await sessionCache.get(cacheKey, () => getAllLightReadings(source, workType), { force });
  return data;
}

async function countUploadedOnPortalDayUncached(source = 'all', workType = '1000', dayYmd) {
  const target = dayYmd || calendarDayKeyInPortalTz(new Date().toISOString());

  if (sessionIndex.enabled && typeof sessionIndex.countUploadedOnPortalDay === 'function') {
    const n = await sessionIndex.countUploadedOnPortalDay(
      source,
      workType,
      target,
      calendarDayKeyInPortalTz,
    );
    console.log(`📊 Uploaded on ${target} (Dynamo): ${n} session(s)`);
    return n;
  }

  const readings = await getAllLightReadings(source, workType);
  const n = readings.filter((r) => calendarDayKeyInPortalTz(r.dateOfReading || '') === target).length;
  console.log(`📊 Uploaded on ${target} (portal): ${n} session(s)`);
  return n;
}

/** Same rule as readings list `?date=YYYY-MM-DD` filter (all sessions, not analytics index). */
async function countUploadedOnPortalDay(source = 'all', workType = '1000', dayYmd, { force = false } = {}) {
  const target = dayYmd || calendarDayKeyInPortalTz(new Date().toISOString());
  const cacheKey = `uploadedToday:${source}:${workType}:${target}`;
  const { data } = await sessionCache.get(
    cacheKey,
    () => countUploadedOnPortalDayUncached(source, workType, target),
    { force },
  );
  return data;
}

async function getReadingsFromFolder(folderPrefix, status, sourceType, workType = '1000') {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: folderPrefix,
      Delimiter: '/',
    });
    
    const response = await s3Client.send(command);
    const folders = response.CommonPrefixes || [];
    
    console.log(`   📂 ${folderPrefix} - ${folders.length} sessions`);
    
    const results = await Promise.all(
      folders.map(folder => parseSession(folder.Prefix, status, sourceType, workType))
    );

    return results.filter(Boolean);
  } catch (error) {
    console.error(`Error listing folder ${folderPrefix}:`, error.message);
    return [];
  }
}

const ALL_STATUSES = ['correct', 'incorrect_new', 'incorrect_analyzed', 'incorrect_labeled', 'incorrect_training', 'no_dials', 'not_sure'];

async function hydrateReadingsFromDynamo(readings) {
  if (!DYNAMO_ATTACH_LIST_IMAGES || !readings.length) return readings;
  return attachPrimaryListImages(readings, getSignedImageUrl, {
    s3Client,
    bucketName: BUCKET_NAME,
    concurrency: Math.max(20, parseInt(process.env.DYNAMO_LIST_PRESIGN_CONCURRENCY || '40', 10) || 40),
  });
}

async function getAllReadingsFromDynamo(source = 'all', workType = '1000') {
  const rows = await sessionIndex.queryReadings(source, workType);
  return hydrateReadingsFromDynamo(rows);
}

async function getAllLightReadingsFromDynamo(source = 'all', workType = '1000') {
  return sessionIndex.queryLightReadings(source, workType);
}

async function fetchAllReadingsUncached(source = 'all', workType = '1000') {
  if (sessionIndex.enabled) {
    try {
      console.log(`\n📇 Fetching readings from Dynamo (source: ${source}, workType: ${workType})`);
      const unique = await getAllReadingsFromDynamo(source, workType);
      console.log(`✅ Total readings (Dynamo): ${unique.length}\n`);
      return unique;
    } catch (err) {
      console.error('📇 Dynamo getAllReadings failed:', err.message);
      if (!DYNAMO_SESSIONS_FALLBACK_S3) throw err;
      console.warn('📇 Falling back to S3 listing');
    }
  }

  console.log(`\n🔍 Fetching readings (source: ${source}, workType: ${workType})`);

  const allPrefixes = getAllFolderPrefixes(source, workType);

  const folderJobs = allPrefixes.map(({ folder, status, sourceType }) =>
    getReadingsFromFolder(folder, status, sourceType, workType),
  );

  const results = await Promise.all(folderJobs);
  const readings = results.flat();

  const byId = new Map();
  for (const r of readings) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
      continue;
    }
    byId.set(r.id, pickPreferredReadingDuplicate(existing, r));
  }
  const unique = [...byId.values()];

  unique.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));

  console.log(`✅ Total readings: ${unique.length}\n`);

  return unique;
}

async function getAllReadings(source = 'all', workType = '1000', { force = false } = {}) {
  const cacheKey = getCacheKey(source, workType);
  const { data, cacheStatus } = await sessionCache.get(
    cacheKey,
    () => fetchAllReadingsUncached(source, workType),
    { force },
  );
  if (cacheStatus !== 'MISS') {
    console.log(`⚡ Readings ${cacheStatus} for ${cacheKey} (${data.length})`);
  }
  getAllReadings.lastCacheStatus = cacheStatus;
  return data;
}
getAllReadings.lastCacheStatus = 'MISS';

/**
 * Count session folders under a status prefix. Paginates delimiter listings (single page
 * was capped at 1000 and could miss folders). If S3 returns no "subfolders" but there are
 * keys under the prefix, infers sessions from the first path segment after the prefix
 * (handles layouts where objects exist without virtual CommonPrefixes).
 */
async function countSessionSubfoldersUnderPrefix(folderPrefix) {
  const normalized = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  let delimiterTotal = 0;
  let continuationToken;
  for (;;) {
    const r = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: normalized,
      Delimiter: '/',
      ContinuationToken: continuationToken,
    }));
    delimiterTotal += (r.CommonPrefixes || []).length;
    if (!r.IsTruncated) break;
    continuationToken = r.NextContinuationToken;
  }
  if (delimiterTotal > 0) return delimiterTotal;

  const sessions = new Set();
  continuationToken = undefined;
  for (;;) {
    const r = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: normalized,
      ContinuationToken: continuationToken,
    }));
    for (const obj of r.Contents || []) {
      if (!obj.Key.startsWith(normalized) || obj.Key.length <= normalized.length) continue;
      const rel = obj.Key.slice(normalized.length);
      const slash = rel.indexOf('/');
      if (slash === -1) {
        if (rel) sessions.add(`__file__:${rel}`);
      } else {
        const seg = rel.slice(0, slash);
        if (seg) sessions.add(seg);
      }
    }
    if (!r.IsTruncated) break;
    continuationToken = r.NextContinuationToken;
  }
  if (sessions.size > 0) {
    console.log(`📊 "${normalized}" delimiter folders: 0; inferred ${sessions.size} session(s) from keys`);
  }
  return sessions.size;
}

// Lightweight counts: Dynamo query or S3 folder listing
async function fetchCountsUncached(source = 'all', workType = '1000') {
  if (sessionIndex.enabled) {
    try {
      console.log(`\n📊 Counting sessions from Dynamo (source: ${source}, workType: ${workType})`);
      const counts = await sessionIndex.queryCounts(source, workType);
      console.log('📊 Counts (Dynamo):', counts);
      return counts;
    } catch (err) {
      console.error('📇 Dynamo getCounts failed:', err.message);
      if (!DYNAMO_SESSIONS_FALLBACK_S3) throw err;
    }
  }

  console.log(`\n📊 Counting sessions (source: ${source}, workType: ${workType})`);

  const allPrefixes = getAllFolderPrefixes(source, workType);

  const countJobs = allPrefixes.map(({ folder }) =>
    countSessionSubfoldersUnderPrefix(folder).catch((err) => {
      console.error(`📊 S3 count failed for prefix "${folder}":`, err.name || err.message);
      return 0;
    }),
  );

  const results = await Promise.all(countJobs);

  const counts = {
    totalPictures: 0,
    correctCount: 0,
    incorrectNewCount: 0,
    incorrectAnalyzedCount: 0,
    incorrectLabeledCount: 0,
    incorrectTrainingCount: 0,
    noDialsCount: 0,
    notSureCount: 0,
    manuallyUploadedCount: 0,
  };

  const statusToKey = {
    correct: 'correctCount',
    incorrect_new: 'incorrectNewCount',
    incorrect_analyzed: 'incorrectAnalyzedCount',
    incorrect_labeled: 'incorrectLabeledCount',
    incorrect_training: 'incorrectTrainingCount',
    no_dials: 'noDialsCount',
    not_sure: 'notSureCount',
    manually_uploaded: 'manuallyUploadedCount',
  };

  results.forEach((count, i) => {
    const status = allPrefixes[i].status;
    if (statusToKey[status]) {
      counts[statusToKey[status]] += count;
    }
    counts.totalPictures += count;
  });

  console.log('📊 Counts:', counts);
  return counts;
}

async function getCountsFromFolders(source = 'all', workType = '1000', { force = false } = {}) {
  const cacheKey = `counts:${source}:${workType}`;
  const { data, cacheStatus } = await sessionCache.get(
    cacheKey,
    () => fetchCountsUncached(source, workType),
    { force },
  );
  if (cacheStatus !== 'MISS') {
    console.log(`⚡ Counts ${cacheStatus} for ${source}:${workType}`);
  }
  getCountsFromFolders.lastCacheStatus = cacheStatus;
  return data;
}
getCountsFromFolders.lastCacheStatus = 'MISS';

/** Same bucket as Models analytics (`unknown` when metadata omits app_version). */
function normalizeReadingAppVersion(r) {
  const raw = r.appVersion != null && String(r.appVersion).trim() !== '' ? String(r.appVersion).trim() : 'unknown';
  return raw;
}

/**
 * Group parsed S3 sessions by metadata `app_version` for model-generation comparison.
 */
function aggregateModelAnalytics(readings) {
  const byVersion = new Map();

  for (const r of readings) {
    const v = normalizeReadingAppVersion(r);
    if (!byVersion.has(v)) {
      byVersion.set(v, {
        appVersion: v,
        sessions: 0,
        sumImages: 0,
        statusCounts: {},
        sumConfidence: 0,
        confidenceN: 0,
        sumProcessingMs: 0,
        processingN: 0,
        sumDialCount: 0,
        dialCountN: 0,
        fieldCount: 0,
        simCount: 0,
        lastSessionAt: null,
        firstSessionAt: null,
      });
    }
    const g = byVersion.get(v);
    g.sessions += 1;
    g.sumImages += Array.isArray(r.images) ? r.images.length : 0;
    const st = r.status || 'unknown';
    g.statusCounts[st] = (g.statusCounts[st] || 0) + 1;
    if (r.type === 'field') g.fieldCount += 1;
    else g.simCount += 1;
    if (typeof r.confidence === 'number' && !Number.isNaN(r.confidence)) {
      g.sumConfidence += r.confidence;
      g.confidenceN += 1;
    }
    if (typeof r.processingTimeMs === 'number' && !Number.isNaN(r.processingTimeMs)) {
      g.sumProcessingMs += r.processingTimeMs;
      g.processingN += 1;
    }
    if (typeof r.dialCount === 'number' && !Number.isNaN(r.dialCount)) {
      g.sumDialCount += r.dialCount;
      g.dialCountN += 1;
    }
    const t = r.dateOfReading ? new Date(r.dateOfReading).getTime() : 0;
    if (t) {
      if (!g.lastSessionAt || t > new Date(g.lastSessionAt).getTime()) g.lastSessionAt = r.dateOfReading;
      if (!g.firstSessionAt || t < new Date(g.firstSessionAt).getTime()) g.firstSessionAt = r.dateOfReading;
    }
  }

  const versions = Array.from(byVersion.values()).map((g) => {
    const c = g.statusCounts.correct || 0;
    const notSure = g.statusCounts.not_sure || 0;
    const noDials = g.statusCounts.no_dials || 0;
    const incorrectTotal = Object.entries(g.statusCounts)
      .filter(([k]) => k.startsWith('incorrect'))
      .reduce((s, [, n]) => s + n, 0);
    const denom = g.sessions || 1;
    return {
      appVersion: g.appVersion,
      sessions: g.sessions,
      imageCount: g.sumImages,
      statusCounts: g.statusCounts,
      correctCount: c,
      incorrectTotal,
      notSureCount: notSure,
      noDialsCount: noDials,
      /** Share of sessions filed under the "correct" queue (user affirmed reading). */
      queueCorrectRate: c / denom,
      /** Share under any incorrect_* queue (disagreement / relabel pipeline). */
      queueIncorrectRate: incorrectTotal / denom,
      notSureRate: notSure / denom,
      noDialsRate: noDials / denom,
      avgConfidence: g.confidenceN ? g.sumConfidence / g.confidenceN : null,
      avgProcessingTimeMs: g.processingN ? g.sumProcessingMs / g.processingN : null,
      avgDialCount: g.dialCountN ? g.sumDialCount / g.dialCountN : null,
      fieldCount: g.fieldCount,
      simulatorCount: g.simCount,
      firstSessionAt: g.firstSessionAt,
      lastSessionAt: g.lastSessionAt,
    };
  });

  versions.sort((a, b) => {
    const ta = a.lastSessionAt ? new Date(a.lastSessionAt).getTime() : 0;
    const tb = b.lastSessionAt ? new Date(b.lastSessionAt).getTime() : 0;
    return tb - ta;
  });

  const currentVersion = versions.length > 0 ? versions[0].appVersion : null;

  return {
    currentVersion,
    versions,
    computedAt: new Date().toISOString(),
  };
}

function utcYmdFromMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Portal-only usage stats from the same S3-backed readings list as the dashboard.
 * Day buckets use UTC date of metadata timestamp. User = user_name / user_email from metadata (else "Unknown").
 */
function aggregateUsageFromReadings(readings, days) {
  const n = Number(days);
  const safeDays = Math.min(90, Math.max(1, Number.isFinite(n) ? n : 14));
  const now = new Date();
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);
  const startUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (safeDays - 1), 0, 0, 0, 0);

  const filtered = readings.filter((r) => {
    const t = r.dateOfReading ? new Date(r.dateOfReading).getTime() : NaN;
    if (Number.isNaN(t)) return false;
    return t >= startUtc && t <= endUtc;
  });

  const dayMap = new Map();
  const userMap = new Map();

  for (const r of filtered) {
    const t = new Date(r.dateOfReading).getTime();
    const dayKey = utcYmdFromMs(t);
    const imgCount = Array.isArray(r.images) ? r.images.length : 0;
    const u = r.userName && String(r.userName).trim() ? String(r.userName).trim() : 'Unknown';

    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, { date: dayKey, sessions: 0, images: 0, userSet: new Set() });
    }
    const day = dayMap.get(dayKey);
    day.sessions += 1;
    day.images += imgCount;
    day.userSet.add(u);

    if (!userMap.has(u)) {
      userMap.set(u, { userKey: u, sessions: 0, images: 0, lastSeen: r.dateOfReading });
    }
    const ur = userMap.get(u);
    ur.sessions += 1;
    ur.images += imgCount;
    if (r.dateOfReading && new Date(r.dateOfReading) > new Date(ur.lastSeen)) {
      ur.lastSeen = r.dateOfReading;
    }
  }

  const byDay = [];
  const cursor = new Date(startUtc);
  for (let i = 0; i < safeDays; i++) {
    const key = utcYmdFromMs(cursor.getTime());
    const row = dayMap.get(key);
    byDay.push(
      row
        ? { date: key, sessions: row.sessions, images: row.images, distinctUsers: row.userSet.size }
        : { date: key, sessions: 0, images: 0, distinctUsers: 0 },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const byUser = Array.from(userMap.values())
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50);

  const totals = {
    sessions: filtered.length,
    images: filtered.reduce((sum, r) => sum + (Array.isArray(r.images) ? r.images.length : 0), 0),
    distinctUsers: userMap.size,
  };

  return {
    daysEffective: safeDays,
    totals,
    byDay,
    byUser,
    windowStartUtc: utcYmdFromMs(startUtc),
    windowEndUtc: utcYmdFromMs(endUtc),
    sessionCountAllScanned: readings.length,
    sessionCountInWindow: filtered.length,
  };
}

// API Routes

app.get('/api/work-types', (req, res) => {
  res.json(WORK_TYPES.map(code => ({
    code,
    name: WORK_TYPE_LABELS[code] || code,
  })));
});

app.get('/api/readings', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    if (force) invalidateReadingsCache(source, workType);
    const readings = await getAllReadings(source, workType, { force });
    setApiCacheHeaders(res, getAllReadings.lastCacheStatus, SESSION_CACHE_FRESH_MS);
    res.json(readings);
  } catch (error) {
    console.error('Error fetching readings:', error);
    res.status(500).json({ error: 'Failed to fetch readings' });
  }
});

app.get('/api/counts', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    if (force) invalidateReadingsCache(source, workType);
    const counts = await getCountsFromFolders(source, workType, { force });
    counts.uploadedTodayCount = await countUploadedOnPortalDay(source, workType, undefined, { force });
    setApiCacheHeaders(res, getCountsFromFolders.lastCacheStatus, SESSION_CACHE_FRESH_MS);
    res.json(counts);
  } catch (error) {
    console.error('Error calculating counts:', error);
    res.status(500).json({ error: 'Failed to calculate counts' });
  }
});

app.get('/api/improvement-stats', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    const range = typeof req.query.range === 'string' && req.query.range.trim() ? req.query.range.trim() : 'all';
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const allowedRanges = new Set(['all', '1d', '7d', '14d', '30d']);
    const safeRange = allowedRanges.has(range) ? range : 'all';

    const payload = await improvementAnalytics.getStats(source, workType, {
      range: safeRange,
      refresh,
      maxVersions: 16,
      fetchAllLightReadings: getAllLightReadings,
    });
    res.json({
      ...payload,
      storage: improvementAnalytics.storageLocation(source, workType),
    });
  } catch (error) {
    console.error('Error fetching improvement stats:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch improvement stats' });
  }
});

app.post('/api/improvement-stats/backfill', async (req, res) => {
  try {
    const source = req.query.source || req.body?.source || 'all';
    const workType = req.query.workType || req.body?.workType || '1000';
    const result = await improvementAnalytics.backfill(source, workType, getAllLightReadings);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Error backfilling improvement stats:', error);
    res.status(500).json({ error: error.message || 'Failed to backfill improvement stats' });
  }
});

app.get('/api/model-analytics', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = typeof req.query.workType === 'string' && req.query.workType.trim()
      ? req.query.workType.trim()
      : '1000';
    const readings = await getAllReadings(source, workType);
    const payload = aggregateModelAnalytics(readings);
    res.json(payload);
  } catch (error) {
    console.error('Error computing model analytics:', error);
    res.status(500).json({ error: 'Failed to compute model analytics' });
  }
});

app.get('/api/usage-summary', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = typeof req.query.workType === 'string' && req.query.workType.trim()
      ? req.query.workType.trim()
      : '1000';
    const daysRaw = parseInt(String(req.query.days || '14'), 10);
    const days = Number.isFinite(daysRaw) ? daysRaw : 14;
    const readings = await getAllReadings(source, workType);
    const payload = aggregateUsageFromReadings(readings, days);
    res.json({
      workType,
      source,
      ...payload,
      computedAt: new Date().toISOString(),
      note:
        'S3 snapshot only: same session list as the dashboard. Sessions bucketed by metadata timestamp (UTC day). '
        + 'User identity = user_name or user_email from metadata.json when present.',
    });
  } catch (error) {
    console.error('Error computing usage summary:', error);
    res.status(500).json({ error: 'Failed to compute usage summary' });
  }
});

app.get('/api/readings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workTypeHint = typeof req.query.workType === 'string' ? req.query.workType.trim() : '';
    console.log(`\n🔍 Fetching reading: ${id}${workTypeHint ? ` (workType hint: ${workTypeHint})` : ''}`);

    const s3SessionPrefix =
      typeof req.query.s3SessionPrefix === 'string' ? req.query.s3SessionPrefix.trim() : '';
    const reading = await resolveReadingById(id, { workTypeHint, s3SessionPrefix });

    if (!reading) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    res.json(reading);
  } catch (error) {
    console.error('Error fetching reading:', error);
    res.status(500).json({ error: 'Failed to fetch reading' });
  }
});

function normalizeS3SessionPrefix(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

const METADATA_PATCHABLE = new Set([
  'user_correction',
  'ml_prediction',
  'ml_raw_prediction',
  'dial_count',
  'dial_details',
  'is_correct',
  'condition_code',
  'portal_review_notes',
  'reviewer_recommend_training',
  'reviewer_dataset_destination',
  'image_difficulty',
  'is_manually_reviewed',
  'confidence',
  'processing_time_ms',
  'portal_manual_review_status',
  'portal_manual_review_notes',
]);

function validateDialDetailsForPatch(dialDetails) {
  if (!Array.isArray(dialDetails)) return 'dial_details must be an array';
  if (dialDetails.length > 48) return 'dial_details: at most 48 rows';
  for (let i = 0; i < dialDetails.length; i += 1) {
    const row = dialDetails[i];
    if (!row || typeof row !== 'object') return `dial_details[${i}]: invalid row`;
    if (!Number.isInteger(row.dial) || row.dial < 1 || row.dial > 48) return `dial_details[${i}]: dial must be 1–48`;
    if (typeof row.prediction !== 'number' || Number.isNaN(row.prediction)) {
      return `dial_details[${i}]: prediction must be a number`;
    }
    if (typeof row.direction !== 'string' || row.direction.length < 1 || row.direction.length > 40) {
      return `dial_details[${i}]: direction must be a non-empty string (≤40 chars)`;
    }
    if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1 || Number.isNaN(row.confidence)) {
      return `dial_details[${i}]: confidence must be between 0 and 1`;
    }
  }
  return null;
}

/**
 * Merge reviewer edits into session `metadata.json` (same bucket). Does not move the session folder.
 * Body: { workType?: string, s3SessionPrefix?: string, patch: { user_correction?, ml_prediction?, dial_details?, ... } }
 */
const MOBILE_COLLECTOR_PATCHABLE = new Set([
  'user_correction',
  'ml_prediction',
  'ml_raw_prediction',
  'dial_details',
  'dial_count',
]);

app.patch('/api/readings/:id/metadata', async (req, res) => {
  try {
    const portalMode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
    const collectorId = String(req.headers['x-user-email'] || '').trim();

    const sessionId = req.params.id;
    const workTypeHint = typeof req.body?.workType === 'string' ? req.body.workType.trim() : '';
    const clientPrefix = normalizeS3SessionPrefix(req.body?.s3SessionPrefix);
    let reading = clientPrefix
      ? await parseSessionAtPrefix(clientPrefix, workTypeHint || '1000')
      : null;
    if (reading && String(reading.id) !== String(sessionId)) {
      reading = null;
    }
    if (!reading) {
      reading = await resolveReadingById(sessionId, { workTypeHint, s3SessionPrefix: clientPrefix });
    }
    if (!reading?.s3SessionPrefix) {
      return res.status(404).json({ error: 'Reading not found or missing s3SessionPrefix' });
    }

    const serverPrefix = normalizeS3SessionPrefix(reading.s3SessionPrefix);
    if (clientPrefix && clientPrefix !== serverPrefix) {
      const atClient = await parseSessionAtPrefix(clientPrefix, workTypeHint || '1000');
      if (atClient && String(atClient.id) !== String(sessionId)) {
        return res.status(400).json({ error: 's3SessionPrefix does not match this session' });
      }
      if (String(reading.id) !== String(sessionId)) {
        return res.status(400).json({ error: 's3SessionPrefix does not match this session' });
      }
      // Stale client prefix (e.g. after folder move or list dedup) — write to canonical serverPrefix.
    }

    const patch = req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : null;
    if (!patch || Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'patch must be an object with at least one allowed field' });
    }

    const metaKey = `${serverPrefix}metadata.json`;
    const getOut = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey }));
    const meta = JSON.parse(await streamToString(getOut.Body));
    if (String(meta.session_id) !== String(sessionId)) {
      return res.status(500).json({ error: 'metadata session_id does not match URL id' });
    }

    const isReviewer = portalMode === 'reviewer' || portalMode === 'admin';
    const isTestDataReviewer = portalMode === 'test_data_reviewer';
    const isMobileCollector = portalMode === 'mobile' && collectorId.length > 0;
    if (!isReviewer && !isTestDataReviewer && !isMobileCollector) {
      return res.status(403).json({
        error:
          'Metadata edits require x-portal-work-mode: reviewer, test_data_reviewer, or mobile (iOS collector) plus x-user-email when mobile.',
      });
    }

    if (isMobileCollector) {
      const owner = String(meta.user_name || meta.user_email || '')
        .trim()
        .toLowerCase();
      if (!owner || owner !== collectorId.toLowerCase()) {
        return res.status(403).json({ error: 'You can only edit captures uploaded under your collector name.' });
      }
    }

    const testDataReviewerOnly = new Set([
      'user_correction',
      'ml_prediction',
      'ml_raw_prediction',
      'dial_details',
      'dial_count',
      'portal_review_notes',
      'is_manually_reviewed',
      'reviewer_dataset_destination',
      'image_difficulty',
    ]);

    for (const k of Object.keys(patch)) {
      const allowed = isReviewer || isTestDataReviewer ? METADATA_PATCHABLE : MOBILE_COLLECTOR_PATCHABLE;
      if (!allowed.has(k)) {
        return res.status(400).json({ error: `Field not allowed in patch: ${k}` });
      }
      if (isTestDataReviewer && !isReviewer && !testDataReviewerOnly.has(k)) {
        return res.status(403).json({ error: `Field not allowed for test_data_reviewer: ${k}` });
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'user_correction')) {
      if (patch.user_correction != null && typeof patch.user_correction !== 'string') {
        return res.status(400).json({ error: 'user_correction must be a string' });
      }
      const v = patch.user_correction == null ? '' : String(patch.user_correction);
      if (v.length > 500) return res.status(400).json({ error: 'user_correction too long (max 500)' });
      meta.user_correction = v;
      const four = v.replace(/\D/g, '');
      if (/^\d{4}$/.test(four)) {
        meta.manual_label_pending = false;
        meta.feedback_type = 'correct';
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'ml_prediction')) {
      if (typeof patch.ml_prediction !== 'string') {
        return res.status(400).json({ error: 'ml_prediction must be a string' });
      }
      if (patch.ml_prediction.length > 500) return res.status(400).json({ error: 'ml_prediction too long' });
      meta.ml_prediction = patch.ml_prediction;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'ml_raw_prediction')) {
      if (patch.ml_raw_prediction != null && typeof patch.ml_raw_prediction !== 'string') {
        return res.status(400).json({ error: 'ml_raw_prediction must be a string' });
      }
      meta.ml_raw_prediction =
        patch.ml_raw_prediction == null ? null : String(patch.ml_raw_prediction).slice(0, 2000);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'dial_details')) {
      const err = validateDialDetailsForPatch(patch.dial_details);
      if (err) return res.status(400).json({ error: err });
      meta.dial_details = patch.dial_details;
      meta.dial_count = patch.dial_details.length;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'dial_count')) {
      if (!Number.isInteger(patch.dial_count) || patch.dial_count < 0 || patch.dial_count > 48) {
        return res.status(400).json({ error: 'dial_count must be an integer 0–48' });
      }
      meta.dial_count = patch.dial_count;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'is_correct')) {
      if (typeof patch.is_correct !== 'boolean') {
        return res.status(400).json({ error: 'is_correct must be boolean' });
      }
      meta.is_correct = patch.is_correct;
      if (String(meta.upload_mode || '').trim().toLowerCase() === 'field') {
        meta.feedback_type = patch.is_correct ? 'correct' : 'incorrect';
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'condition_code')) {
      if (patch.condition_code != null && typeof patch.condition_code !== 'string') {
        return res.status(400).json({ error: 'condition_code must be a string' });
      }
      meta.condition_code =
        patch.condition_code == null ? null : String(patch.condition_code).slice(0, 200);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'portal_review_notes')) {
      if (typeof patch.portal_review_notes !== 'string') {
        return res.status(400).json({ error: 'portal_review_notes must be a string' });
      }
      if (patch.portal_review_notes.length > 8000) {
        return res.status(400).json({ error: 'portal_review_notes too long (max 8000)' });
      }
      meta.portal_review_notes = patch.portal_review_notes;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'reviewer_recommend_training')) {
      if (typeof patch.reviewer_recommend_training !== 'boolean') {
        return res.status(400).json({ error: 'reviewer_recommend_training must be boolean' });
      }
      meta.reviewer_recommend_training = patch.reviewer_recommend_training;
      if (patch.reviewer_recommend_training) {
        meta.reviewer_dataset_destination = 'training';
      } else if (meta.reviewer_dataset_destination === 'training') {
        meta.reviewer_dataset_destination = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'reviewer_dataset_destination')) {
      const dest = patch.reviewer_dataset_destination;
      if (dest != null && dest !== 'training' && dest !== 'test') {
        return res.status(400).json({ error: 'reviewer_dataset_destination must be training, test, or null' });
      }
      const priorDest =
        meta.reviewer_dataset_destination === 'training' || meta.reviewer_dataset_destination === 'test'
          ? meta.reviewer_dataset_destination
          : meta.reviewer_recommend_training === true
            ? 'training'
            : null;
      meta.reviewer_dataset_destination = dest;
      meta.reviewer_recommend_training = dest === 'training';
      if (dest === 'test' && meta.test_data_review_status !== 'approved') {
        meta.test_data_review_status = 'pending';
      }
      if (dest !== 'test') {
        meta.test_data_review_status = null;
        meta.test_data_submitted_by = null;
        meta.test_data_submitted_at = null;
      } else if (priorDest !== 'test') {
        meta.test_data_submitted_at = new Date().toISOString();
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'image_difficulty')) {
      const d = patch.image_difficulty;
      if (d != null && d !== 'normal' && d !== 'difficult' && d !== 'very_difficult') {
        return res.status(400).json({ error: 'image_difficulty must be normal, difficult, very_difficult, or null' });
      }
      meta.image_difficulty = d;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'is_manually_reviewed')) {
      if (typeof patch.is_manually_reviewed !== 'boolean') {
        return res.status(400).json({ error: 'is_manually_reviewed must be boolean' });
      }
      meta.is_manually_reviewed = patch.is_manually_reviewed;
      if (patch.is_manually_reviewed === true && Object.prototype.hasOwnProperty.call(meta, 'is_human_reviewed')) {
        delete meta.is_human_reviewed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'confidence')) {
      if (typeof patch.confidence !== 'number' || patch.confidence < 0 || patch.confidence > 1 || Number.isNaN(patch.confidence)) {
        return res.status(400).json({ error: 'confidence must be a number from 0 to 1' });
      }
      meta.confidence = patch.confidence;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'processing_time_ms')) {
      if (typeof patch.processing_time_ms !== 'number' || patch.processing_time_ms < 0 || Number.isNaN(patch.processing_time_ms)) {
        return res.status(400).json({ error: 'processing_time_ms must be a non-negative number' });
      }
      meta.processing_time_ms = patch.processing_time_ms;
    }

    const userEmail = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'].trim() : '';

    if (Object.prototype.hasOwnProperty.call(patch, 'portal_manual_review_status')) {
      if (!isReviewer) {
        return res.status(403).json({ error: 'portal_manual_review_status requires reviewer or admin mode' });
      }
      const status = patch.portal_manual_review_status;
      if (status !== 'correct' && status !== 'incorrect') {
        return res.status(400).json({ error: 'portal_manual_review_status must be correct or incorrect' });
      }
      meta.portal_manual_review_status = status;
      meta.portal_manual_reviewed_at = new Date().toISOString();
      if (userEmail) meta.portal_manual_reviewed_by = userEmail.slice(0, 320);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'portal_manual_review_notes')) {
      if (!isReviewer) {
        return res.status(403).json({ error: 'portal_manual_review_notes requires reviewer or admin mode' });
      }
      if (typeof patch.portal_manual_review_notes !== 'string') {
        return res.status(400).json({ error: 'portal_manual_review_notes must be a string' });
      }
      if (patch.portal_manual_review_notes.length > 8000) {
        return res.status(400).json({ error: 'portal_manual_review_notes too long (max 8000)' });
      }
      meta.portal_manual_review_notes = patch.portal_manual_review_notes;
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, 'user_correction') ||
      Object.prototype.hasOwnProperty.call(patch, 'dial_details')
    ) {
      meta.reads_corrected_count = inferReadsCorrectedFromMetadata(meta);
    }

    meta.portal_metadata_updated_at = new Date().toISOString();
    if (userEmail) meta.portal_metadata_updated_by = userEmail.slice(0, 320);
    if (
      meta.reviewer_dataset_destination === 'test' &&
      meta.test_data_review_status === 'pending' &&
      meta.test_data_submitted_at &&
      !meta.test_data_submitted_by &&
      userEmail
    ) {
      meta.test_data_submitted_by = userEmail.slice(0, 320);
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: metaKey,
        Body: JSON.stringify(meta, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );

    await syncSessionIndexFromMetadata(sessionIndex, meta, {
      s3Bucket: BUCKET_NAME,
      s3SessionPrefix: serverPrefix,
      folderStatus: reading.status,
      sourceType: reading.type,
      portalWorkType: reading.workType || workTypeHint || '1000',
      ingestSource: 'portal_dual_write',
    });

    invalidateReadingsCache('all', reading.workType || workTypeHint || '1000');

    await loadActivityLog();
    activityLog.unshift({
      id: `${Date.now()}-${sessionId}-meta`,
      timestamp: new Date().toISOString(),
      userEmail: userEmail || 'unknown',
      action: 'metadata_patch',
      sessionId,
      keys: Object.keys(patch),
    });
    await saveActivityLog();

    const fresh = await parseSession(serverPrefix, reading.status, reading.type, reading.workType || '1000');
    if (!fresh) {
      return res.status(500).json({ error: 'Failed to re-read session after metadata update' });
    }
    const analyticsSource = typeof req.query.source === 'string' ? req.query.source : 'all';
    const analyticsWorkType = fresh.workType || workTypeHint || '1000';
    syncImprovementFromReading(analyticsSource, analyticsWorkType, fresh);
    res.json(fresh);
  } catch (error) {
    console.error('PATCH /api/readings/:id/metadata:', error);
    res.status(500).json({ error: error.message || 'Metadata update failed' });
  }
});

function buildTargetSessionPrefixFromSource(sourcePrefix, sourceType, targetStatus) {
  const normalized = sourcePrefix.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const sessionFolder = parts.pop();
  parts.pop();
  const modePrefix = sourceType === 'field' ? 'f_' : 's_';
  const tgtSuffix = STATUS_FOLDER_MAP[targetStatus] || 'incorrect';
  const newStatusSeg = `${modePrefix}${tgtSuffix}`;
  parts.push(newStatusSeg, sessionFolder);
  return `${parts.join('/')}/`;
}

async function collectAllObjectKeysUnderPrefix(prefix) {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const keys = [];
  let continuationToken;
  for (;;) {
    const r = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: normalized,
      ContinuationToken: continuationToken,
    }));
    for (const o of r.Contents || []) {
      if (o.Key) keys.push(o.Key);
    }
    if (!r.IsTruncated) break;
    continuationToken = r.NextContinuationToken;
  }
  return keys;
}

/** `folderPrefix` must be under {@link getTrainingDatasetsRootPrefix} (trailing slash). */
function normalizeTrainingDatasetFolderPrefix(input) {
  const root = getTrainingDatasetsRootPrefix();
  let p = String(input || '').trim();
  if (!p) return null;
  const withSlash = p.endsWith('/') ? p : `${p}/`;
  if (!withSlash.startsWith(root)) return null;
  if (withSlash.length <= root.length) return null;
  return withSlash;
}

/** Copy every object under sourcePrefix into destPrefix (same relative paths). Does not delete source. */
const COPY_PREFIX_CONCURRENCY = Math.min(
  32,
  Math.max(2, parseInt(process.env.COPY_PREFIX_CONCURRENCY || '10', 10) || 10),
);

async function copyObjectsConcurrently(copyJobs) {
  for (let i = 0; i < copyJobs.length; i += COPY_PREFIX_CONCURRENCY) {
    const batch = copyJobs.slice(i, i + COPY_PREFIX_CONCURRENCY);
    await Promise.all(
      batch.map(({ sourceKey, destKey }) =>
        s3Client.send(
          new CopyObjectCommand({
            Bucket: BUCKET_NAME,
            CopySource: `${BUCKET_NAME}/${sourceKey}`,
            Key: destKey,
          }),
        ),
      ),
    );
  }
}

/** Copy every object under sourcePrefix into destPrefix (same relative paths). Does not delete source. */
async function copyPrefixTree(sourcePrefix, destPrefix) {
  const src = sourcePrefix.endsWith('/') ? sourcePrefix : `${sourcePrefix}/`;
  const dst = destPrefix.endsWith('/') ? destPrefix : `${destPrefix}/`;
  const keys = await collectAllObjectKeysUnderPrefix(src);
  if (keys.length === 0) return { objectCount: 0 };
  const copyJobs = [];
  for (const key of keys) {
    const relative = key.startsWith(src) ? key.slice(src.length) : '';
    if (relative === '') continue;
    copyJobs.push({ sourceKey: key, destKey: `${dst}${relative}` });
  }
  await copyObjectsConcurrently(copyJobs);
  return { objectCount: copyJobs.length };
}

async function readTrainingDatasetManifest(folderPrefix) {
  const norm = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  const key = `${norm}dataset.json`;
  const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  return JSON.parse(await streamToString(obj.Body));
}

async function writeTrainingDatasetManifest(folderPrefix, manifest) {
  const norm = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  const key = `${norm}dataset.json`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json; charset=utf-8',
    }),
  );
}

async function copySessionIntoTrainingDataset(sourcePrefix, datasetFolderPrefix, sessionId) {
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_') || 'session';
  const src = sourcePrefix.endsWith('/') ? sourcePrefix : `${sourcePrefix}/`;
  const dest = `${datasetFolderPrefix}sessions/${safeId}/`;
  return copyPrefixTree(src, dest);
}

/**
 * Raw / full-frame images under a copied session (same idea as uncropped captures for training).
 * Excludes `dial_*` model crops and non-images — aligns preview with "raw" frames, not dial strips.
 */
function isTrainingDatasetRawImageKey(key) {
  const name = (key.split('/').pop() || '').toLowerCase();
  if (!/\.(jpe?g|png)$/i.test(name)) return false;
  if (name === 'metadata.json') return false;
  if (name.startsWith('dial_')) return false;
  return true;
}

function countTrainingDatasetRawImageKeys(keys) {
  return keys.filter(isTrainingDatasetRawImageKey).length;
}

/** Training ZIP: raw meter photos (same rule as session previews) + pipeline `dataset.json` only — no dial crops, metadata, or model/. */
function shouldIncludeKeyInRawTrainingZipExport(rel, key) {
  if (!rel || rel.endsWith('/')) return false;
  if (rel.startsWith('model/')) return false;
  if (rel === 'dataset.json') return true;
  return isTrainingDatasetRawImageKey(key);
}

/** Safe single-segment filename for flat ZIP (no subfolders). */
function sanitizeTrainingZipFlatSegment(s) {
  return String(s || 'item')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'item';
}

/**
 * Flat layout: everything at ZIP root — `dataset.json` plus `{sessionId}_{imageFile}` for each raw frame
 * (no `sessions/.../` tree).
 */
function flatZipEntryNameForTrainingExport(rel) {
  if (rel === 'dataset.json') return 'dataset.json';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'sessions') {
    const sessionFolder = sanitizeTrainingZipFlatSegment(parts[1]);
    const leaf = sanitizeTrainingZipFlatSegment(parts[parts.length - 1]);
    return `${sessionFolder}_${leaf}`;
  }
  return sanitizeTrainingZipFlatSegment(parts.join('_'));
}

/** Thumbnail: raw images only; prefer original.jpg, then other full-frame files (never dial_*). */
function pickTrainingSessionPreviewImageKey(keys) {
  const imgs = keys.filter(isTrainingDatasetRawImageKey);
  if (imgs.length === 0) return null;
  const score = (k) => {
    const name = (k.split('/').pop() || '').toLowerCase();
    if (name === 'original.jpg') return 0;
    return 1;
  };
  imgs.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
  return imgs[0];
}

/** Lowercased display names for duplicate pipeline name checks. */
async function existingTrainingDatasetDisplayNamesLowerCase() {
  const root = getTrainingDatasetsRootPrefix();
  const out = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: root,
      Delimiter: '/',
      MaxKeys: 500,
    }),
  );
  const set = new Set();
  for (const cp of out.CommonPrefixes || []) {
    if (!cp.Prefix) continue;
    try {
      const m = await readTrainingDatasetManifest(cp.Prefix);
      if (typeof m.displayName === 'string' && m.displayName.trim()) {
        set.add(m.displayName.trim().toLowerCase());
      }
    } catch {
      /* manifest missing — skip */
    }
  }
  return set;
}

/** List `…/sessions/{id}/` prefixes under a training dataset (bounded). */
async function listTrainingDatasetSessionPrefixes(folderPrefix, maxPrefixes) {
  const norm = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  const base = `${norm}sessions/`;
  const prefixes = [];
  let token;
  const cap = Math.min(300, Math.max(1, maxPrefixes || 120));
  for (;;) {
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: base,
        Delimiter: '/',
        MaxKeys: 500,
        ContinuationToken: token,
      }),
    );
    for (const cp of out.CommonPrefixes || []) {
      if (cp.Prefix && prefixes.length < cap) prefixes.push(cp.Prefix);
    }
    if (!out.IsTruncated || prefixes.length >= cap) break;
    token = out.NextContinuationToken;
  }
  return prefixes;
}

/** Incorrect-queue statuses we advance when `weights.pt` is uploaded (not correct / no_dials / not_sure). */
const WEIGHTS_PROMOTE_FROM_STATUSES = new Set(['incorrect_new', 'incorrect_analyzed', 'incorrect_labeled']);

function trainingWeightsAutoPromoteSessionsEnabled() {
  const v = String(process.env.TRAINING_WEIGHTS_AUTO_PROMOTE_SESSIONS ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

async function collectTrainingDatasetSessionIdsForWeightsPromotion(folderPrefix, manifest) {
  const ids = new Set();
  for (const id of Array.isArray(manifest.copiedSessionIds) ? manifest.copiedSessionIds : []) {
    if (typeof id === 'string' && id.trim()) ids.add(id.trim());
  }
  try {
    const prefixes = await listTrainingDatasetSessionPrefixes(folderPrefix, 500);
    for (const pref of prefixes) {
      const parts = String(pref || '')
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean);
      const sid = parts[parts.length - 1];
      if (sid) ids.add(sid);
    }
  } catch (e) {
    console.warn('collectTrainingDatasetSessionIdsForWeightsPromotion list:', e.message);
  }
  return [...ids];
}

/**
 * After weights upload: move live S3 sessions that were copied into this pipeline to `incorrect_training`
 * so labeler lists show them as trained / added-to-training (same queue as manual "train" stage).
 */
async function promoteSessionsToIncorrectTrainingAfterWeights(folderPrefix, manifest) {
  const empty = {
    enabled: true,
    sessionCountConsidered: 0,
    moved: 0,
    skippedAlready: 0,
    skippedNotInPipeline: 0,
    notFound: 0,
    moveFailed: 0,
    movedSessions: [],
  };
  if (!trainingWeightsAutoPromoteSessionsEnabled()) {
    return { ...empty, enabled: false, movedSessions: [] };
  }

  const sessionIds = await collectTrainingDatasetSessionIdsForWeightsPromotion(folderPrefix, manifest);
  if (sessionIds.length === 0) {
    return { ...empty, sessionCountConsidered: 0, movedSessions: [] };
  }

  const want = new Set(sessionIds);
  const idToReading = new Map();
  for (const wt of WORK_TYPES) {
    const list = await getAllReadings('all', wt);
    for (const r of list) {
      if (want.has(r.id) && !idToReading.has(r.id)) idToReading.set(r.id, r);
    }
    if (idToReading.size === want.size) break;
  }

  let moved = 0;
  let skippedAlready = 0;
  let skippedNotInPipeline = 0;
  let notFound = 0;
  let moveFailed = 0;
  /** @type {{ sessionId: string, fromStatus: string, sourceType: string }[]} */
  const movedSessions = [];

  const CHUNK = 5;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const outcomes = await Promise.all(
      chunk.map(async (sessionId) => {
        const reading = idToReading.get(sessionId);
        if (!reading?.s3SessionPrefix) return { code: 'not_found' };
        if (reading.status === 'incorrect_training') return { code: 'skipped_already' };
        if (!WEIGHTS_PROMOTE_FROM_STATUSES.has(reading.status)) return { code: 'skipped_not_pipeline' };
        const fromStatus = reading.status;
        const sourceType = reading.type;
        const ok = await moveSessionByS3Prefix(reading.s3SessionPrefix, reading.type, 'incorrect_training');
        if (ok) return { code: 'moved', sessionId, fromStatus, sourceType };
        return { code: 'move_failed' };
      }),
    );
    for (const o of outcomes) {
      if (o.code === 'moved') {
        moved += 1;
        movedSessions.push({
          sessionId: o.sessionId,
          fromStatus: o.fromStatus,
          sourceType: o.sourceType,
        });
      } else if (o.code === 'skipped_already') skippedAlready += 1;
      else if (o.code === 'skipped_not_pipeline') skippedNotInPipeline += 1;
      else if (o.code === 'not_found') notFound += 1;
      else if (o.code === 'move_failed') moveFailed += 1;
    }
  }

  return {
    enabled: true,
    sessionCountConsidered: sessionIds.length,
    moved,
    skippedAlready,
    skippedNotInPipeline,
    notFound,
    moveFailed,
    movedSessions,
  };
}

/**
 * Move a session when the client provides the exact S3 prefix (METR/s_correct/session/, etc.).
 */
async function moveSessionByS3Prefix(s3SessionPrefix, sourceType, targetStatus) {
  const sourcePrefix = s3SessionPrefix.endsWith('/') ? s3SessionPrefix : `${s3SessionPrefix}/`;
  const targetPrefix = buildTargetSessionPrefixFromSource(sourcePrefix, sourceType, targetStatus);
  if (!targetPrefix || targetPrefix === sourcePrefix) {
    console.error('  ❌ moveSessionByS3Prefix: bad target', { sourcePrefix, targetPrefix });
    return false;
  }
  const keys = await collectAllObjectKeysUnderPrefix(sourcePrefix);
  if (keys.length === 0) {
    console.error(`  ❌ No objects under ${sourcePrefix}`);
    return false;
  }
  console.log(`  📦 Moving ${keys.length} object(s)\n     ${sourcePrefix}\n  -> ${targetPrefix}`);
  for (const key of keys) {
    const relative = key.startsWith(sourcePrefix) ? key.slice(sourcePrefix.length) : key;
    const newKey = `${targetPrefix}${relative}`;
    await s3Client.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${key}`,
      Key: newKey,
    }));
  }
  for (const key of keys) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  }

  try {
    const metaKey = `${targetPrefix}metadata.json`;
    const getOut = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey }));
    const meta = JSON.parse(await streamToString(getOut.Body));
    await syncSessionIndexFromMetadata(sessionIndex, meta, {
      s3Bucket: BUCKET_NAME,
      s3SessionPrefix: targetPrefix,
      folderStatus: targetStatus,
      sourceType,
      ingestSource: 'portal_move',
    });
  } catch (err) {
    const sessionFolder = targetPrefix.split('/').filter(Boolean).pop();
    if (sessionFolder) {
      await syncSessionIndexAfterMove(sessionIndex, {
        sessionId: sessionFolder,
        s3SessionPrefix: targetPrefix,
        folderStatus: targetStatus,
        sourceType,
      });
    } else {
      console.warn('📇 Dynamo move sync skipped:', err.message);
    }
  }

  return true;
}

async function moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus) {
  const sourceFolder = getFolderForStatus(sourceType, currentStatus);
  const targetFolder = getFolderForStatus(sourceType, targetStatus);
  
  const possiblePrefixes = [
    `${sourceFolder}${sessionId}/`,
    `${sourceFolder}${sourceType === 'field' ? 'f_' : 's_'}${sessionId}/`,
  ];
  
  let sourcePrefix = null;
  
  for (const prefix of possiblePrefixes) {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 1,
      });
      const response = await s3Client.send(listCommand);
      if (response.Contents && response.Contents.length > 0) {
        sourcePrefix = prefix;
        break;
      }
    } catch (e) {
      // Continue to next prefix
    }
  }
  
  if (!sourcePrefix) {
    console.error(`  ❌ Session folder not found for ${sessionId} in ${sourceFolder}`);
    return false;
  }
  
  console.log(`  📦 Moving ${sourcePrefix} -> ${targetFolder}`);
  
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: sourcePrefix,
    });
    
    const listResponse = await s3Client.send(listCommand);
    const objects = listResponse.Contents || [];
    
    if (objects.length === 0) {
      console.error(`  ❌ No objects found in ${sourcePrefix}`);
      return false;
    }
    
    await Promise.all(objects.map(async (obj) => {
      const fileName = obj.Key.replace(sourcePrefix, '');
      const newKey = `${targetFolder}${sourcePrefix.split('/').slice(-2, -1)[0]}/${fileName}`;
      
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${obj.Key}`,
        Key: newKey,
      }));
      
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: obj.Key,
      }));
    }));
    
    console.log(`  ✅ Moved ${objects.length} files`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error moving session ${sessionId}:`, error.message);
    return false;
  }
}

const ACTIVITY_LOG_KEY = withS3Base('activity-log.json');
let activityLog = [];
let activityLogLoaded = false;

async function loadActivityLog() {
  if (activityLogLoaded) return;
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: ACTIVITY_LOG_KEY });
    const response = await s3Client.send(command);
    const json = await streamToString(response.Body);
    activityLog = JSON.parse(json);
    console.log(`📋 Loaded ${activityLog.length} activity log entries from S3`);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      console.log('📋 No existing activity log found, starting fresh');
    } else {
      console.error('Failed to load activity log:', err.message);
    }
    activityLog = [];
  }
  activityLogLoaded = true;
}

async function saveActivityLog() {
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: ACTIVITY_LOG_KEY,
      Body: JSON.stringify(activityLog),
      ContentType: 'application/json',
    }));
  } catch (err) {
    console.error('Failed to save activity log to S3:', err.message);
  }
}

app.post('/api/readings/bulk-move', async (req, res) => {
  try {
    const { readings } = req.body;
    
    if (!readings || !Array.isArray(readings)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    console.log(`\n🔄 Bulk moving ${readings.length} readings...`);
    
    const moveResults = await Promise.all(
      readings.map(({ sessionId, sourceType, currentStatus, targetStatus, s3SessionPrefix }) => {
        console.log(`  Moving ${sessionId}: ${currentStatus} -> ${targetStatus}`);
        if (typeof s3SessionPrefix === 'string' && s3SessionPrefix.length > 4) {
          return moveSessionByS3Prefix(s3SessionPrefix, sourceType, targetStatus);
        }
        return moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus);
      })
    );

    const movedCount = moveResults.filter(Boolean).length;
    
    console.log(`✅ Moved ${movedCount}/${readings.length} readings\n`);

    const analyticsSource = req.query.source || req.body?.source || 'all';
    const analyticsWorkType = req.query.workType || req.body?.workType || '1000';
    invalidateReadingsCache(analyticsSource, analyticsWorkType);
    for (let i = 0; i < readings.length; i++) {
      if (!moveResults[i]) continue;
      const item = readings[i];
      const srcPrefix =
        typeof item.s3SessionPrefix === 'string' && item.s3SessionPrefix.length > 4
          ? item.s3SessionPrefix.endsWith('/')
            ? item.s3SessionPrefix
            : `${item.s3SessionPrefix}/`
          : null;
      if (!srcPrefix) continue;
      const targetPrefix = buildTargetSessionPrefixFromSource(
        srcPrefix,
        item.sourceType,
        item.targetStatus,
      );
      if (!targetPrefix) continue;
      scheduleImprovementUpdate(async () => {
        const light = await parseSessionLight(
          targetPrefix,
          item.targetStatus,
          item.sourceType,
          analyticsWorkType,
        );
        if (light) {
          await improvementAnalytics.upsertFromReading(analyticsSource, analyticsWorkType, light);
        }
      });
    }
    
    await loadActivityLog();
    const auditTs = new Date().toISOString();
    const auditBatch = [];
    for (let i = 0; i < readings.length; i += 1) {
      const reading = readings[i];
      activityLog.unshift({
        id: `${Date.now()}-${reading.sessionId}`,
        timestamp: auditTs,
        userEmail: req.headers['x-user-email'] || 'unknown',
        action: 'status_change',
        sessionId: reading.sessionId,
        fromStatus: reading.currentStatus,
        toStatus: reading.targetStatus,
        sourceType: reading.sourceType,
      });
      auditBatch.push({
        ts: auditTs,
        source: 'portal',
        action: 'session.status_change',
        intent: `Bulk move ${reading.currentStatus} → ${reading.targetStatus}`,
        actor: { email: req.headers['x-user-email'] },
        target: { sessionId: reading.sessionId, workType: reading.workType },
        detail: {
          fromStatus: reading.currentStatus,
          toStatus: reading.targetStatus,
          sourceType: reading.sourceType,
        },
        outcome: moveResults[i] ? 'success' : 'failure',
      });
    }
    await saveActivityLog();
    if (auditBatch.length > 0) {
      try {
        await appendAuditEvents(s3Client, BUCKET_NAME, auditBatch, req.headers);
      } catch (e) {
        console.warn('audit-events (bulk-move):', e.message);
      }
    }
    
    res.json({ success: true, moved: movedCount, total: readings.length });
  } catch (error) {
    console.error('Error in bulk move:', error);
    res.status(500).json({ error: 'Failed to move readings' });
  }
});

app.get('/api/activity-log', async (req, res) => {
  await loadActivityLog();
  res.json(activityLog);
});

/**
 * Capture history for one collector — matches iOS `metadata.user_name` (Settings name).
 * Query `userName` or header `x-user-email` (exact match, case-insensitive).
 */
app.get('/api/captures/history', async (req, res) => {
  try {
    const userName =
      (typeof req.query.userName === 'string' && req.query.userName.trim()) ||
      String(req.headers['x-user-email'] || '').trim();
    if (!userName) {
      return res.status(400).json({
        error: 'userName query (or x-user-email header) is required — must match iOS metadata.user_name.',
      });
    }

    const source = req.query.source || 'all';
    const workType =
      typeof req.query.workType === 'string' && req.query.workType.trim()
        ? req.query.workType.trim()
        : '1000';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

    const needle = userName.toLowerCase();
    const all = await getAllReadings(source, workType);
    const matched = all.filter((r) => {
      const name = (r.userName || '').trim().toLowerCase();
      return name === needle;
    });

    const sortBy =
      req.query.sortBy === 'confidence'
        ? 'confidence'
        : req.query.sortBy === 'reading'
          ? 'reading'
          : 'date';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    matched.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'confidence') {
        const l = normalizeSessionConfidenceValue(a.confidence) ?? -1;
        const r = normalizeSessionConfidenceValue(b.confidence) ?? -1;
        cmp = l - r;
      } else if (sortBy === 'reading') {
        cmp = String(a.meterValue || '').localeCompare(String(b.meterValue || ''), undefined, {
          numeric: true,
        });
      } else {
        cmp = new Date(a.dateOfReading).getTime() - new Date(b.dateOfReading).getTime();
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    const total = matched.length;
    const captures = matched.slice(offset, offset + limit);

    res.json({
      userName,
      workType,
      source,
      total,
      offset,
      limit,
      sortBy,
      sortOrder,
      captures,
    });
  } catch (error) {
    console.error('GET /api/captures/history:', error);
    res.status(500).json({ error: 'Failed to fetch capture history' });
  }
});

/** List iOS unit-test CSV exports under `{workType}/unit_test_results/`. */
app.get('/api/unit-test/runs', async (req, res) => {
  try {
    const workType =
      typeof req.query.workType === 'string' && req.query.workType.trim()
        ? req.query.workType.trim()
        : '1000';
    const includeSummary = req.query.includeSummary === 'true' || req.query.includeSummary === '1';
    const summaryLimitRaw = parseInt(String(req.query.summaryLimit ?? ''), 10);
    const summaryLimit = Number.isFinite(summaryLimitRaw) && summaryLimitRaw > 0
      ? summaryLimitRaw
      : UNIT_TEST_SUMMARY_DEFAULT_LIMIT;
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheKey = `${workType}:${includeSummary ? 'summary' : 'keys'}:${summaryLimit}`;

    const { data: payload, cacheStatus } = await unitTestRunsCache.get(
      cacheKey,
      async () => {
        const folderRoots = getS3FolderRootsForPortalWorkType(workType);
        const seen = new Set();
        const runs = [];
        const prefixes = [];
        for (const root of folderRoots) {
          const prefix = withS3Base(`${root}/unit_test_results/`);
          prefixes.push(prefix);
          const batch = await listUnitTestResultCsvKeys(s3Client, BUCKET_NAME, prefix);
          for (const run of batch) {
            if (seen.has(run.key)) continue;
            seen.add(run.key);
            runs.push(run);
          }
        }
        runs.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
        if (includeSummary && runs.length > 0) {
          const enriched = await enrichUnitTestRunsWithSummary(s3Client, BUCKET_NAME, runs, streamToString, {
            limit: summaryLimit,
          });
          return { workType, prefix: prefixes[0] ?? null, prefixes, runs: enriched, summaryLimit };
        }
        return { workType, prefix: prefixes[0] ?? null, prefixes, runs };
      },
      { force },
    );
    setApiCacheHeaders(res, cacheStatus, UNIT_TEST_CACHE_FRESH_MS);
    res.json(payload);
  } catch (error) {
    console.error('GET /api/unit-test/runs:', error);
    res.status(500).json({ error: 'Failed to list unit test runs' });
  }
});

function decodeUnitTestS3KeyParam(raw) {
  let key = String(raw ?? '').trim();
  if (!key) return '';
  try {
    key = decodeURIComponent(key);
  } catch {
    /* use raw */
  }
  return key;
}

function validateUnitTestCsvKey(key) {
  if (!key.endsWith('.csv') || key.includes('..')) {
    return 'Invalid s3Key';
  }
  return null;
}

async function fetchUnitTestRunDetailPayload(key, includeRows) {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const csvText = await streamToString(out.Body);
  const parsed = parseUnitTestCsvSummary(csvText);
  let perImageRows = includeRows ? parsed.perImageRows : undefined;
  if (perImageRows?.length) {
    const workType = inferWorkTypeFromUnitTestCsvKey(key);
    perImageRows = await refreshUnitTestPerImageRowKeys(
      s3Client,
      BUCKET_NAME,
      workType,
      perImageRows,
    );
  }
  return {
    key,
    summary: parsed.summary,
    imageDifficultyBreakdown: parsed.imageDifficultyBreakdown,
    perImageCount: parsed.perImageCount,
    perImageRows,
  };
}

/** Parse unit-test CSV (query param — reliable through Vite proxy; prefer over path param). */
app.get('/api/unit-test/run-detail', async (req, res) => {
  try {
    const key = decodeUnitTestS3KeyParam(req.query.s3Key);
    const keyErr = validateUnitTestCsvKey(key);
    if (keyErr) return res.status(400).json({ error: keyErr });
    const includeRows = req.query.includeRows !== 'false';
    res.json(await fetchUnitTestRunDetailPayload(key, includeRows));
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'CSV not found' });
    }
    console.error('GET /api/unit-test/run-detail:', error);
    res.status(500).json({ error: 'Failed to parse unit test CSV' });
  }
});

/** Parse unit-test CSV summary + optional per-image rows (legacy path param). */
app.get('/api/unit-test/runs/:s3Key', async (req, res) => {
  try {
    const key = decodeUnitTestS3KeyParam(req.params.s3Key);
    const keyErr = validateUnitTestCsvKey(key);
    if (keyErr) return res.status(400).json({ error: keyErr });
    const includeRows = req.query.includeRows !== 'false';
    res.json(await fetchUnitTestRunDetailPayload(key, includeRows));
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'CSV not found' });
    }
    console.error('GET /api/unit-test/runs/:s3Key:', error);
    res.status(500).json({ error: 'Failed to parse unit test CSV' });
  }
});

/** Presigned download URL for a unit-test CSV (query s3Key — keys contain `/`). */
app.get('/api/unit-test/download-url', async (req, res) => {
  try {
    const key = String(req.query.s3Key ?? '').trim();
    if (!key.endsWith('.csv') || key.includes('..')) {
      return res.status(400).json({ error: 'Invalid s3Key' });
    }
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: 3600 },
    );
    res.json({ url, expiresInSeconds: 3600 });
  } catch (error) {
    console.error('GET /api/unit-test/download-url:', error);
    res.status(500).json({ error: 'Failed to create download URL' });
  }
});

/** Presigned download URL for a unit-test CSV. */
app.get('/api/unit-test/runs/:s3Key/download-url', async (req, res) => {
  try {
    let key = req.params.s3Key || '';
    try {
      key = decodeURIComponent(key);
    } catch {
      /* use raw */
    }
    if (!key.endsWith('.csv') || key.includes('..')) {
      return res.status(400).json({ error: 'Invalid s3Key' });
    }
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: 3600 },
    );
    res.json({ url, expiresInSeconds: 3600 });
  } catch (error) {
    console.error('GET /api/unit-test/runs/download-url:', error);
    res.status(500).json({ error: 'Failed to create download URL' });
  }
});

app.get('/api/uploads', async (req, res) => {
  try {
    const email = req.query.email;
    const source = req.query.source || 'all';
    const workType = typeof req.query.workType === 'string' && req.query.workType.trim()
      ? req.query.workType.trim()
      : '1000';
    
    const readings = await getAllReadings(source, workType);
    
    const uploads = readings.map(r => ({
      id: r.id,
      sessionId: r.id,
      timestamp: r.dateOfReading,
      userEmail: r.userName || email || '',
      sourceType: r.type,
      workType: r.workType || workType,
      imageCount: r.images.length,
      prediction: r.meterValue,
      isCorrect: r.isCorrect ?? (r.status === 'correct'),
      status: r.status,
    }));
    
    res.json(uploads);
  } catch (error) {
    console.error('Error fetching uploads:', error);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

/** List training-dataset folders (S3 prefixes + dataset.json manifest when present). */
app.get('/api/training-datasets', async (req, res) => {
  try {
    const root = getTrainingDatasetsRootPrefix();
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: root,
        Delimiter: '/',
        MaxKeys: 500,
      }),
    );
    const prefixes = (out.CommonPrefixes || []).map((p) => p.Prefix).filter(Boolean);
    const datasets = await Promise.all(
      prefixes.map(async (folderPrefix) => {
        const metaKey = `${folderPrefix}dataset.json`;
        try {
          const obj = await s3Client.send(
            new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: metaKey,
            }),
          );
          const body = await streamToString(obj.Body);
          const j = JSON.parse(body);
          const copiedIds = Array.isArray(j.copiedSessionIds) ? j.copiedSessionIds : [];
          const w = j.weights && typeof j.weights === 'object' ? j.weights : null;
          return {
            folderPrefix,
            displayName: typeof j.displayName === 'string' ? j.displayName : folderPrefix,
            createdAt: typeof j.createdAt === 'string' ? j.createdAt : null,
            slug: typeof j.slug === 'string' ? j.slug : null,
            timestamp: typeof j.timestamp === 'number' ? j.timestamp : null,
            copiedSessionCount: copiedIds.length,
            lastCopyAt: typeof j.lastCopyAt === 'string' ? j.lastCopyAt : null,
            weights: w?.s3Key
              ? {
                  s3Key: typeof w.s3Key === 'string' ? w.s3Key : null,
                  uploadedAt: typeof w.uploadedAt === 'string' ? w.uploadedAt : null,
                  sizeBytes: typeof w.sizeBytes === 'number' ? w.sizeBytes : null,
                  originalFileName: typeof w.originalFileName === 'string' ? w.originalFileName : null,
                }
              : null,
            roboflowTraining: normalizeTrainingDatasetRoboflowTraining(j.roboflowTraining ?? j.roboflow_training),
          };
        } catch {
          const leaf = folderPrefix.slice(root.length).replace(/\/$/, '');
          return {
            folderPrefix,
            displayName: leaf,
            createdAt: null,
            slug: null,
            timestamp: null,
            manifestMissing: true,
          };
        }
      }),
    );
    datasets.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({
      bucket: BUCKET_NAME,
      rootPrefix: root,
      trainingDatasetsSegment: TRAINING_DATASETS_SEGMENT,
      datasets,
    });
  } catch (e) {
    console.error('training-datasets GET:', e);
    res.status(500).json({ error: e.message || 'Failed to list training datasets' });
  }
});

/**
 * Create an empty training-dataset folder: `{slug}_{timestamp}/dataset.json` under the training root.
 * Body: `{ "name": "My export" }` — slug is derived from name; folder name is slug + numeric timestamp.
 */
app.post('/api/training-datasets', async (req, res) => {
  try {
    const displayName =
      typeof req.body?.name === 'string' ? req.body.name.trim() : typeof req.body?.displayName === 'string'
        ? req.body.displayName.trim()
        : '';
    if (!displayName || displayName.length > 200) {
      return res.status(400).json({ error: 'Name is required and must be 200 characters or less.' });
    }
    const existingNames = await existingTrainingDatasetDisplayNamesLowerCase();
    if (existingNames.has(displayName.toLowerCase())) {
      return res.status(409).json({
        error: `A pipeline named "${displayName}" already exists. Choose a different name.`,
      });
    }
    const slug = sanitizeDatasetSlug(displayName);
    const timestamp = Date.now();
    const folderSegment = `${slug}_${timestamp}`;
    const root = getTrainingDatasetsRootPrefix();
    const folderPrefix = `${root}${folderSegment}/`;
    const key = `${folderPrefix}dataset.json`;
    const manifest = {
      schemaVersion: 1,
      displayName,
      createdAt: new Date(timestamp).toISOString(),
      folderPrefix,
      slug,
      timestamp,
      note: 'Portal copies sessions via POST /api/training-datasets/copy-sessions; ZIP via GET /api/export/training-dataset-zip (flat root: raw images as sessionId_file.jpg + dataset.json; no sessions/ subfolders; excludes dial_* crops, metadata.json, model/); weights via POST /api/training-datasets/weights.',
    };
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
    res.status(201).json({
      ...manifest,
      key,
      bucket: BUCKET_NAME,
    });
  } catch (e) {
    console.error('training-datasets POST:', e);
    res.status(500).json({ error: e.message || 'Failed to create training dataset' });
  }
});

/** Inspect bucket layout vs what the app scans (debug local / staging). */
app.get('/api/s3-discover', async (req, res) => {
  try {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : (S3_BASE_PREFIX ? `${S3_BASE_PREFIX.replace(/\/+$/, '')}/` : '');
    const out = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      Delimiter: '/',
      MaxKeys: 500,
    }));
    const sampleKeys = (out.Contents || []).slice(0, 40).map((c) => c.Key);
    const commonPrefixes = (out.CommonPrefixes || []).map((p) => p.Prefix);
    const scanned = getAllFolderPrefixes('all', '1000');
    const probe = await Promise.all(
      scanned.slice(0, 6).map(async ({ folder }) => {
        try {
          const r = await s3Client.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: folder,
            Delimiter: '/',
            MaxKeys: 1,
          }));
          return { folder, sessionFolders: (r.CommonPrefixes || []).length };
        } catch (e) {
          return { folder, error: e.message };
        }
      }),
    );
    res.json({
      bucket: BUCKET_NAME,
      region: REGION,
      s3BasePrefix: S3_BASE_PREFIX || null,
      queriedPrefix: prefix || '(empty = bucket root)',
      commonPrefixesAtQuery: commonPrefixes,
      sampleKeysAtQuery: sampleKeys,
      firstScannedPrefixesProbe: probe,
      hint: 'Meter reading (workType 1000) scans METR/ and 1000/ (iOS vs legacy), plus bucket-root f_/s_* and correct|incorrect/. Set AWS_S3_BASE_PREFIX if the tree lives under a parent prefix.',
      isTruncated: out.IsTruncated,
    });
  } catch (e) {
    console.error('s3-discover:', e);
    res.status(500).json({ error: e.message, name: e.name });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    bucket: BUCKET_NAME,
    workTypes: WORK_TYPES,
    region: REGION,
    s3BasePrefix: S3_BASE_PREFIX || null,
    trainingDatasetsRootPrefix: getTrainingDatasetsRootPrefix(),
    trainingWeightsMaxMb: Math.round(TRAINING_WEIGHTS_MAX_BYTES / (1024 * 1024)),
    roboflow: Boolean(process.env.ROBOFLOW_API_KEY),
    dynamoSessionsTable: sessionIndex.enabled ? sessionIndex.tableName : null,
    dynamoSessionsFallbackS3: DYNAMO_SESSIONS_FALLBACK_S3,
    apiCache: {
      sessions: sessionCache.snapshot(),
      unitTestRuns: unitTestRunsCache.snapshot(),
    },
  });
});

registerRoboflowRoutes(app, {
  WORK_TYPES,
  getAllReadings,
  s3Client,
  BUCKET_NAME,
});

registerTrainingDatasetRoboflowRoutes(app, {
  s3Client,
  BUCKET_NAME,
  normalizeTrainingDatasetFolderPrefix,
  readTrainingDatasetManifest,
  writeTrainingDatasetManifest,
});

const EXPORT_INCORRECT_MAX_SESSIONS = Math.max(
  1,
  Math.min(10_000, parseInt(process.env.EXPORT_INCORRECT_MAX_SESSIONS || '3000', 10) || 3000),
);

/** Resolve a reading by session id; uses Dynamo when enabled, then S3 prefix parse. */
async function resolveReadingById(id, { workTypeHint = '', s3SessionPrefix = '' } = {}) {
  const normPrefix = normalizeS3SessionPrefix(s3SessionPrefix);
  if (normPrefix) {
    const direct = await parseSessionAtPrefix(normPrefix, workTypeHint || '1000');
    if (direct && String(direct.id) === String(id)) {
      return direct;
    }
  }

  if (sessionIndex.enabled) {
    try {
      const item = await sessionIndex.getBySessionId(id);
      if (item?.s3_session_prefix) {
        const prefix = normPrefix || item.s3_session_prefix;
        const full = await parseSessionAtPrefix(prefix, workTypeHint || item.portal_work_type || '1000');
        if (full && String(full.id) === String(id)) return full;
        const light = readingFromDynamoItem(item);
        if (light && String(light.id) === String(id)) {
          const [withImg] = await hydrateReadingsFromDynamo([light]);
          return withImg || light;
        }
      }
    } catch (err) {
      console.error('📇 resolveReadingById Dynamo:', err.message);
      if (!DYNAMO_SESSIONS_FALLBACK_S3) throw err;
    }
  }

  if (workTypeHint && WORK_TYPES.includes(workTypeHint)) {
    const list = await getAllReadings('all', workTypeHint);
    const hit = list.find((r) => r.id === id);
    if (hit) return hit;
  }

  for (const wt of WORK_TYPES) {
    if (wt === workTypeHint) continue;
    const list = await getAllReadings('all', wt);
    const hit = list.find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

/** @deprecated Prefer {@link resolveReadingById} with s3SessionPrefix when available. */
async function findReadingAcrossWorkTypes(id, workTypeHint) {
  return resolveReadingById(id, { workTypeHint });
}

registerTestDataReviewRoutes(app, {
  s3Client,
  BUCKET_NAME,
  resolveReadingById,
  normalizeS3SessionPrefix,
  streamToString,
  getPresignedUrl: getSignedImageUrl,
  invalidateReadingsCache,
  syncSessionIndexFromMetadata: (metadata, ctx) =>
    syncSessionIndexFromMetadata(sessionIndex, metadata, {
      s3Bucket: BUCKET_NAME,
      ingestSource: 'portal_dual_write',
      ...ctx,
    }),
});

registerFieldTestRoutes(app, {
  s3Client,
  BUCKET_NAME,
  sessionIndex,
  getPresignedUrl: getSignedImageUrl,
});

registerReviewAssignmentRoutes(app, {
  s3Client,
  bucket: BUCKET_NAME,
  sessionIndex,
  requireAdmin: isAdminPortalRequest,
});

registerAuditEventRoutes(app, {
  s3Client,
  bucket: BUCKET_NAME,
  requireAdmin: isAdminPortalRequest,
  getPortalSessionsForUser: async (userName, fromDay, toDay) => {
    const needle = userName.toLowerCase();
    const all = await getAllReadings('all', '1000');
    return all.filter((r) => {
      const name = (r.userName || '').trim().toLowerCase();
      if (name !== needle) return false;
      const day = calendarDayKeyInPortalTz(r.dateOfReading || '');
      return day && day >= fromDay && day <= toDay;
    });
  },
});

const MANUAL_UPLOAD_MAX_BYTES = Math.max(
  256 * 1024,
  Math.min(20 * 1024 * 1024, parseInt(process.env.MANUAL_UPLOAD_MAX_BYTES || String(12 * 1024 * 1024), 10) || 12 * 1024 * 1024),
);
const MANUAL_UPLOAD_MAX_FILES = Math.max(
  1,
  Math.min(100, parseInt(process.env.MANUAL_UPLOAD_MAX_FILES || '50', 10) || 50),
);

const manualImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MANUAL_UPLOAD_MAX_BYTES, files: 1 },
});

const manualImageBulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MANUAL_UPLOAD_MAX_BYTES, files: MANUAL_UPLOAD_MAX_FILES },
});

function manualUploadMulterError(err, res) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Image too large (max ${Math.round(MANUAL_UPLOAD_MAX_BYTES / (1024 * 1024))} MB).`,
    });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: `Too many files (max ${MANUAL_UPLOAD_MAX_FILES}).` });
  }
  return res.status(400).json({ error: err.message || 'Upload parse failed' });
}

function manualUploadMiddleware(req, res, next) {
  manualImageUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    manualUploadMulterError(err, res);
  });
}

function manualBulkUploadMiddleware(req, res, next) {
  manualImageBulkUpload.array('images', MANUAL_UPLOAD_MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    manualUploadMulterError(err, res);
  });
}

registerManualUploadRoutes(app, {
  s3Client,
  BUCKET_NAME,
  withS3Base,
  invalidateReadingsCache,
  parseSession,
  uploadMiddleware: manualUploadMiddleware,
  bulkUploadMiddleware: manualBulkUploadMiddleware,
  syncSessionIndexFromMetadata: (metadata, ctx) =>
    syncSessionIndexFromMetadata(sessionIndex, metadata, {
      s3Bucket: BUCKET_NAME,
      ingestSource: 'portal_dual_write',
      ...ctx,
    }),
});

// registerPortalInferenceRoutes(app, {
//   s3Client,
//   BUCKET_NAME,
//   withS3Base,
//   invalidateReadingsCache,
//   parseSession,
//   bulkUploadMiddleware: manualBulkUploadMiddleware,
// });

const COPY_TO_TRAINING_MAX_SESSIONS = Math.max(
  1,
  Math.min(500, parseInt(process.env.COPY_TO_TRAINING_MAX_SESSIONS || '80', 10) || 80),
);

const TRAINING_DATASET_EXPORT_MAX_OBJECTS = Math.max(
  50,
  Math.min(25_000, parseInt(process.env.TRAINING_DATASET_EXPORT_MAX_OBJECTS || '8000', 10) || 8000),
);

/** Roboflow / YOLO `weights.pt` per pipeline — stored at `{folderPrefix}model/weights.pt`. */
const TRAINING_WEIGHTS_MAX_BYTES = Math.max(
  1024 * 1024,
  Math.min(
    2 * 1024 * 1024 * 1024,
    parseInt(process.env.TRAINING_WEIGHTS_MAX_BYTES || String(512 * 1024 * 1024), 10) || 512 * 1024 * 1024,
  ),
);
const WEIGHTS_S3_RELATIVE_KEY = 'model/weights.pt';

const weightsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TRAINING_WEIGHTS_MAX_BYTES, files: 1 },
});

function weightsUploadMiddleware(req, res, next) {
  weightsUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `weights.pt too large (max ${Math.round(TRAINING_WEIGHTS_MAX_BYTES / (1024 * 1024))} MB). Set TRAINING_WEIGHTS_MAX_BYTES if needed.`,
      });
    }
    return res.status(400).json({ error: err.message || 'Upload parse failed' });
  });
}

/**
 * Copy meter sessions (raw S3 objects) into a training-dataset folder under sessions/{sessionId}/.
 * Body: { folderPrefix, sessions: [{ sessionId, s3SessionPrefix?, workType? }] }
 */
app.post('/api/training-datasets/copy-sessions', async (req, res) => {
  try {
    const folderPrefix = normalizeTrainingDatasetFolderPrefix(req.body?.folderPrefix);
    if (!folderPrefix) {
      return res.status(400).json({
        error: 'folderPrefix must be a training dataset folder under the configured training root.',
      });
    }
    const sessions = req.body?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ error: 'sessions must be a non-empty array.' });
    }
    if (sessions.length > COPY_TO_TRAINING_MAX_SESSIONS) {
      return res.status(400).json({
        error: `Too many sessions in one request (max ${COPY_TO_TRAINING_MAX_SESSIONS}). Split into batches.`,
      });
    }

    let manifest;
    try {
      manifest = await readTrainingDatasetManifest(folderPrefix);
    } catch {
      return res.status(404).json({
        error: 'dataset.json not found for this folder. Create the training dataset in the portal first.',
      });
    }

    const copied = [];
    const errors = [];

    for (const entry of sessions) {
      const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : '';
      if (!sessionId) {
        errors.push({ sessionId: entry.sessionId, error: 'missing sessionId' });
        continue;
      }
      let sourcePrefix = typeof entry.s3SessionPrefix === 'string' ? entry.s3SessionPrefix.trim() : '';
      if (!sourcePrefix || sourcePrefix.length < 4) {
        errors.push({
          sessionId,
          error: 's3SessionPrefix is required (reload the readings list and copy again).',
        });
        continue;
      }
      try {
        const { objectCount } = await copySessionIntoTrainingDataset(sourcePrefix, folderPrefix, sessionId);
        const safeId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_') || 'session';
        copied.push({
          sessionId,
          objectCount,
          destinationPrefix: `${folderPrefix}sessions/${safeId}/`,
        });
      } catch (e) {
        errors.push({ sessionId, error: e.message || String(e) });
      }
    }

    const idsAdded = copied.map((c) => c.sessionId);
    manifest.lastCopyAt = new Date().toISOString();
    manifest.lastCopyBatchCount = idsAdded.length;
    manifest.copiedSessionIds = [...new Set([...(Array.isArray(manifest.copiedSessionIds) ? manifest.copiedSessionIds : []), ...idsAdded])].slice(-800);
    await writeTrainingDatasetManifest(folderPrefix, manifest);

    res.json({ ok: true, copied, errors });
  } catch (e) {
    console.error('training-datasets copy-sessions:', e);
    res.status(500).json({ error: e.message || 'Copy failed' });
  }
});

/**
 * Thumbnail preview for sessions copied under `{folderPrefix}sessions/{sessionId}/`.
 * Query: folderPrefix (URL-encoded, same as other training APIs).
 */
app.get('/api/training-datasets/copied-sessions-preview', async (req, res) => {
  try {
    const raw = typeof req.query.folderPrefix === 'string' ? req.query.folderPrefix.trim() : '';
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const folderPrefix = normalizeTrainingDatasetFolderPrefix(decoded);
    if (!folderPrefix) {
      return res.status(400).json({
        error: 'folderPrefix query must be a training dataset folder under the configured root (URL-encoded).',
      });
    }

    try {
      await readTrainingDatasetManifest(folderPrefix);
    } catch {
      return res.status(404).json({ error: 'dataset.json not found for this folder.' });
    }

    const sessionPrefixes = await listTrainingDatasetSessionPrefixes(folderPrefix, 120);
    const sessions = [];
    const CONC = 8;
    for (let i = 0; i < sessionPrefixes.length; i += CONC) {
      const chunk = sessionPrefixes.slice(i, i + CONC);
      const part = await Promise.all(
        chunk.map(async (pref) => {
          const r2 = await s3Client.send(
            new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: pref, MaxKeys: 120 }),
          );
          const keys = (r2.Contents || []).map((c) => c.Key).filter(Boolean);
          const pick = pickTrainingSessionPreviewImageKey(keys);
          const parts = pref.replace(/\/$/, '').split('/');
          const sessionId = parts[parts.length - 1] || 'session';
          let thumbUrl = null;
          if (pick) {
            thumbUrl = await getSignedImageUrl(pick);
          }
          const imageCount = countTrainingDatasetRawImageKeys(keys);
          return { sessionId, thumbUrl, imageCount };
        }),
      );
      sessions.push(...part);
    }

    sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    res.json({ folderPrefix, sessions });
  } catch (e) {
    console.error('training-datasets copied-sessions-preview:', e);
    res.status(500).json({ error: e.message || 'Preview failed' });
  }
});

/**
 * Upload trained weights for a pipeline (e.g. Roboflow `weights.pt`) → S3 `{folderPrefix}model/weights.pt`.
 * Multipart: field `folderPrefix` (full encoded prefix), file field `file` (.pt only).
 */
app.post('/api/training-datasets/weights', weightsUploadMiddleware, async (req, res) => {
  try {
    const folderPrefix = normalizeTrainingDatasetFolderPrefix(req.body?.folderPrefix);
    if (!folderPrefix) {
      return res.status(400).json({
        error: 'folderPrefix must be a training dataset folder under the configured training root.',
      });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Missing file field "file" with a non-empty .pt body.' });
    }
    const orig = String(req.file.originalname || '').trim().toLowerCase();
    if (!orig.endsWith('.pt')) {
      return res.status(400).json({ error: 'File must use a .pt extension (e.g. weights.pt).' });
    }

    let manifest;
    try {
      manifest = await readTrainingDatasetManifest(folderPrefix);
    } catch {
      return res.status(404).json({
        error: 'dataset.json not found for this folder. Create the pipeline in the portal first.',
      });
    }

    const weightsKey = `${folderPrefix}${WEIGHTS_S3_RELATIVE_KEY}`;
    const contentType = req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
      ? req.file.mimetype
      : 'application/octet-stream';

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: weightsKey,
        Body: req.file.buffer,
        ContentType: contentType,
      }),
    );

    const uploadedAt = new Date().toISOString();
    manifest.weights = {
      s3Key: weightsKey,
      bucket: BUCKET_NAME,
      relativeKey: WEIGHTS_S3_RELATIVE_KEY,
      uploadedAt,
      sizeBytes: req.file.size,
      originalFileName: String(req.file.originalname || 'weights.pt').trim() || 'weights.pt',
      contentType,
    };

    const sessionPromotion = await promoteSessionsToIncorrectTrainingAfterWeights(folderPrefix, manifest);
    const { movedSessions, ...sessionPromotionForManifest } = sessionPromotion;
    manifest.lastWeightsSessionPromotion = {
      at: uploadedAt,
      targetStatus: 'incorrect_training',
      ...sessionPromotionForManifest,
    };

    await writeTrainingDatasetManifest(folderPrefix, manifest);

    if (sessionPromotion.enabled && sessionPromotion.moved > 0) {
      invalidateReadingsCache('all', '1000');
    }

    const userEmail = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'].trim() : '';
    if (movedSessions.length > 0) {
      await loadActivityLog();
      const ts = new Date().toISOString();
      for (const m of movedSessions) {
        activityLog.unshift({
          id: `${Date.now()}-${m.sessionId}-weights-promote`,
          timestamp: ts,
          userEmail: userEmail || 'unknown',
          action: 'status_change',
          sessionId: m.sessionId,
          fromStatus: m.fromStatus,
          toStatus: 'incorrect_training',
          sourceType: m.sourceType,
        });
      }
      await saveActivityLog();
    }

    res.status(201).json({
      ok: true,
      weights: manifest.weights,
      sessionPromotion: sessionPromotionForManifest,
    });
  } catch (e) {
    console.error('training-datasets weights POST:', e);
    res.status(500).json({ error: e.message || 'Weights upload failed' });
  }
});

/**
 * Short-lived HTTPS URL for iOS (or tooling) to download `model/weights.pt` without listing the whole bucket.
 * Query: folderPrefix (URL-encoded, same as other training APIs).
 */
app.get('/api/training-datasets/weights-signed-url', async (req, res) => {
  try {
    const raw = typeof req.query.folderPrefix === 'string' ? req.query.folderPrefix.trim() : '';
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const folderPrefix = normalizeTrainingDatasetFolderPrefix(decoded);
    if (!folderPrefix) {
      return res.status(400).json({
        error: 'folderPrefix query must be a training dataset folder under the configured root (URL-encoded).',
      });
    }

    let manifest;
    try {
      manifest = await readTrainingDatasetManifest(folderPrefix);
    } catch {
      return res.status(404).json({ error: 'dataset.json not found for this pipeline.' });
    }
    const key = manifest.weights && typeof manifest.weights.s3Key === 'string' ? manifest.weights.s3Key : '';
    if (!key || !key.startsWith(folderPrefix)) {
      return res.status(404).json({ error: 'No weights.pt uploaded for this pipeline yet.' });
    }

    const expiresIn = Math.min(
      86400,
      Math.max(60, parseInt(process.env.TRAINING_WEIGHTS_SIGNED_URL_TTL_SEC || '3600', 10) || 3600),
    );
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    res.json({
      url,
      expiresInSeconds: expiresIn,
      bucket: BUCKET_NAME,
      key,
    });
  } catch (e) {
    console.error('training-datasets weights-signed-url:', e);
    res.status(500).json({ error: e.message || 'Signed URL failed' });
  }
});

/** Allowed `listStatus` values for GET /api/export/list-retrain-zip (must match portal routes). */
const VALID_LIST_EXPORT_STATUSES = new Set([
  'all',
  'correct',
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
  'no_dials',
  'not_sure',
  'manually_uploaded',
  'incorrect-queues',
]);

/**
 * Filter loaded readings for ZIP export (same semantics as readings list: status + optional day or from/to range).
 * @param {string | null} dateIso single day YYYY-MM-DD (wins over range when set)
 * @param {string | null} fromIso inclusive range start
 * @param {string | null} toIso inclusive range end
 * @param {string | null} appVersionFilter optional exact match on normalized metadata app_version
 */
function filterReadingsForZipExport(readings, listStatus, dateIso, fromIso, toIso, appVersionFilter) {
  let out = readings;
  if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    out = out.filter((r) => (r.dateOfReading || '').split('T')[0] === dateIso);
  } else if (
    fromIso &&
    toIso &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromIso) &&
    /^\d{4}-\d{2}-\d{2}$/.test(toIso)
  ) {
    const lo = fromIso <= toIso ? fromIso : toIso;
    const hi = fromIso <= toIso ? toIso : fromIso;
    out = out.filter((r) => {
      const day = (r.dateOfReading || '').split('T')[0];
      return day && day >= lo && day <= hi;
    });
  }
  if (appVersionFilter != null && String(appVersionFilter).trim() !== '') {
    const target = String(appVersionFilter).trim();
    out = out.filter((r) => normalizeReadingAppVersion(r) === target);
  }
  if (listStatus === 'all') {
    // keep all (after date filter)
  } else if (listStatus === 'incorrect-queues') {
    out = out.filter((r) => typeof r.status === 'string' && r.status.startsWith('incorrect'));
  } else {
    out = out.filter((r) => r.status === listStatus);
  }
  const seen = new Set();
  const sessions = [];
  for (const r of out) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    sessions.push(r);
  }
  return sessions;
}

/** Allocate unique flat ZIP entry names (no subfolders). */
function createFlatZipNameAllocator() {
  const used = new Set();
  return (wanted) => {
    let name = wanted;
    let n = 0;
    while (used.has(name)) {
      n += 1;
      const dot = wanted.lastIndexOf('.');
      if (dot > 0) {
        name = `${wanted.slice(0, dot)}_${n}${wanted.slice(dot)}`;
      } else {
        name = `${wanted}_${n}`;
      }
    }
    used.add(name);
    return name;
  };
}

/**
 * Append raw full-frame meter images only (excludes dial_* crops) at ZIP root as `{sessionId}_{file}`.
 * Same rule as training-dataset flat export / Roboflow-friendly layout.
 */
async function appendReadingSessionFlatRawImages(archive, r, allocFlatZipName) {
  const safeId = String(r.id).replace(/[^a-zA-Z0-9._-]/g, '_') || 'session';
  const addedKeys = new Set();
  for (const img of r.images || []) {
    const key = img.id;
    const fname = img.fileName || (key && key.split('/').pop()) || 'image.jpg';
    if (!key || addedKeys.has(key) || !isTrainingDatasetRawImageKey(key)) continue;
    addedKeys.add(key);
    try {
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
      if (obj.Body) {
        const buf = await streamToBuffer(obj.Body);
        if (buf && buf.length) {
          const stem = `${safeId}_${sanitizeTrainingZipFlatSegment(fname)}`;
          const flatName = allocFlatZipName(stem);
          archive.append(buf, { name: flatName });
        }
      }
    } catch (e) {
      console.warn(`flat retrain zip skip image ${key}:`, e.message);
    }
  }
}

function countFlatRawImagesInReading(r) {
  let n = 0;
  const seen = new Set();
  for (const img of r.images || []) {
    const key = img.id;
    if (!key || seen.has(key) || !isTrainingDatasetRawImageKey(key)) continue;
    seen.add(key);
    n += 1;
  }
  return n;
}

function buildFlatRetrainDatasetManifest(fields) {
  return {
    schemaVersion: 1,
    exportKind: 'flat-retrain-zip',
    createdAt: new Date().toISOString(),
    note:
      'Flat ZIP for Roboflow / external training: raw full-frame images only (no dial_* crops, no per-session folders, no session metadata.json). Entry names are sessionId_filename.',
    ...fields,
  };
}

/**
 * ZIP a single session: flat root, raw full-frame images only + dataset.json (Roboflow-friendly; no dial_* crops, no metadata.json).
 * Query: sessionId (required), workType (optional hint for faster lookup).
 */
app.get('/api/export/session-retrain-zip', async (req, res) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';
    const workTypeHint = typeof req.query.workType === 'string' ? req.query.workType.trim() : '';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId query parameter is required.' });
    }

    const reading = await findReadingAcrossWorkTypes(sessionId, workTypeHint);
    if (!reading) {
      return res.status(404).json({ error: 'Reading not found', sessionId });
    }

    const rawCount = countFlatRawImagesInReading(reading);
    if (rawCount === 0) {
      return res.status(404).json({
        error:
          'No raw full-frame images to export for this session (only dial crops or empty). Need files such as original.jpg at session root.',
        sessionId,
      });
    }

    const safeFile = String(reading.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `session-flat-${safeFile}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', '1');
    res.setHeader('X-Export-Raw-Image-Count', String(rawCount));

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const allocFlatZipName = createFlatZipNameAllocator();
    await appendReadingSessionFlatRawImages(archive, reading, allocFlatZipName);
    const manifest = buildFlatRetrainDatasetManifest({
      sessionId: reading.id,
      workType: reading.workType || workTypeHint || undefined,
      sessionCount: 1,
      imageCount: rawCount,
    });
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'dataset.json' });
    await archive.finalize();
  } catch (e) {
    console.error('session-retrain-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

/**
 * ZIP sessions matching a readings list view: flat root, raw full-frame images only + dataset.json (Roboflow-friendly).
 * Excludes dial_* crops and session metadata.json. Filenames: sessionId_file.jpg at ZIP root.
 * Query: workType, source, listStatus (required), date (optional single day), from & to (optional inclusive range; ignored if date set).
 */
app.get('/api/export/list-retrain-zip', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = typeof req.query.workType === 'string' && req.query.workType.trim()
      ? req.query.workType.trim()
      : '1000';
    const listStatus =
      typeof req.query.listStatus === 'string' && req.query.listStatus.trim()
        ? req.query.listStatus.trim()
        : '';
    const dateRaw = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
    const fromRaw = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const toRaw = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const fromIso = !dateIso && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;
    const toIso = !dateIso && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : null;
    const appVerRaw = typeof req.query.appVersion === 'string' ? req.query.appVersion.trim() : '';
    const appVersionFilter = appVerRaw ? appVerRaw : null;

    if (!VALID_LIST_EXPORT_STATUSES.has(listStatus)) {
      return res.status(400).json({
        error: 'Invalid or missing listStatus. Use a readings list route segment (e.g. all, correct, incorrect_new, incorrect-queues).',
        listStatus: listStatus || null,
      });
    }

    const readings = await getAllReadings(source, workType);
    const sessions = filterReadingsForZipExport(readings, listStatus, dateIso, fromIso, toIso, appVersionFilter);

    if (sessions.length === 0) {
      return res.status(404).json({
        error: 'No sessions match this export (work type, source, list filter, and optional date/range / app version).',
        workType,
        source,
        listStatus,
        date: dateIso,
        from: fromIso,
        to: toIso,
        appVersion: appVersionFilter,
      });
    }

    const truncated = sessions.slice(0, EXPORT_INCORRECT_MAX_SESSIONS);
    const truncatedFlag = sessions.length > truncated.length;

    let totalRawImages = 0;
    for (const r of truncated) {
      totalRawImages += countFlatRawImagesInReading(r);
    }
    if (totalRawImages === 0) {
      return res.status(404).json({
        error:
          'No raw full-frame images to export for this filter (sessions may only contain dial crops). Need captures such as original.jpg.',
        workType,
        source,
        listStatus,
        date: dateIso,
        from: fromIso,
        to: toIso,
        appVersion: appVersionFilter,
      });
    }

    const safeSlug = String(listStatus).replace(/[^a-zA-Z0-9_-]/g, '_');
    let datePart = '';
    if (dateIso) datePart = `-${dateIso}`;
    else if (fromIso && toIso) {
      const lo = fromIso <= toIso ? fromIso : toIso;
      const hi = fromIso <= toIso ? toIso : fromIso;
      datePart = lo === hi ? `-${lo}` : `-${lo}_${hi}`;
    }
    let appPart = '';
    if (appVersionFilter) {
      appPart = `-${String(appVersionFilter).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    }
    const filename = `sessions-flat-${safeSlug}${datePart}${appPart}-${workType}-${source}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', String(truncated.length));
    res.setHeader('X-Export-Total-Found', String(sessions.length));
    res.setHeader('X-Export-Raw-Image-Count', String(totalRawImages));
    if (truncatedFlag) res.setHeader('X-Export-Truncated', 'true');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const allocFlatZipName = createFlatZipNameAllocator();
    for (const r of truncated) {
      await appendReadingSessionFlatRawImages(archive, r, allocFlatZipName);
    }
    const manifest = buildFlatRetrainDatasetManifest({
      listStatus,
      workType,
      source,
      sessionCount: truncated.length,
      imageCount: totalRawImages,
      ...(dateIso ? { date: dateIso } : {}),
      ...(fromIso && toIso ? { from: fromIso, to: toIso } : {}),
      ...(appVersionFilter ? { appVersion: appVersionFilter } : {}),
    });
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'dataset.json' });

    await archive.finalize();
  } catch (e) {
    console.error('list-retrain-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

/**
 * Flat ZIP: all sessions in any incorrect_* queue (same slice as dashboard: workType + source).
 * Same shape as list-retrain-zip?listStatus=incorrect-queues (raw photos + dataset.json at root).
 */
app.get('/api/export/incorrect-retrain-zip', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = typeof req.query.workType === 'string' && req.query.workType.trim()
      ? req.query.workType.trim()
      : '1000';

    const readings = await getAllReadings(source, workType);
    const sessions = filterReadingsForZipExport(readings, 'incorrect-queues', null, null, null, null);

    if (sessions.length === 0) {
      return res.status(404).json({
        error: 'No incorrect sessions found for this work type and source filter.',
        workType,
        source,
      });
    }

    const truncated = sessions.slice(0, EXPORT_INCORRECT_MAX_SESSIONS);
    const truncatedFlag = sessions.length > truncated.length;

    let totalRawImages = 0;
    for (const r of truncated) {
      totalRawImages += countFlatRawImagesInReading(r);
    }
    if (totalRawImages === 0) {
      return res.status(404).json({
        error:
          'No raw full-frame images to export (sessions may only contain dial crops). Need captures such as original.jpg.',
        workType,
        source,
      });
    }

    const filename = `incorrect-flat-${workType}-${source}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', String(truncated.length));
    res.setHeader('X-Export-Total-Found', String(sessions.length));
    res.setHeader('X-Export-Raw-Image-Count', String(totalRawImages));
    if (truncatedFlag) res.setHeader('X-Export-Truncated', 'true');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const allocFlatZipName = createFlatZipNameAllocator();
    for (const r of truncated) {
      await appendReadingSessionFlatRawImages(archive, r, allocFlatZipName);
    }
    const manifest = buildFlatRetrainDatasetManifest({
      listStatus: 'incorrect-queues',
      workType,
      source,
      sessionCount: truncated.length,
      imageCount: totalRawImages,
    });
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'dataset.json' });

    await archive.finalize();
  } catch (e) {
    console.error('incorrect-retrain-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

/**
 * ZIP raw meter images for a training-dataset folder (no dial_* crops) plus `dataset.json` at the root.
 * Archive has **no subfolders**: images are `{sessionId}_{filename}` at top level (Roboflow-friendly flat folder).
 * Excludes metadata.json, model/, and other objects.
 * Query: folderPrefix (full S3 prefix, URL-encoded). Caps total objects via TRAINING_DATASET_EXPORT_MAX_OBJECTS.
 */
app.get('/api/export/training-dataset-zip', async (req, res) => {
  try {
    const raw = typeof req.query.folderPrefix === 'string' ? req.query.folderPrefix.trim() : '';
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const folderPrefix = normalizeTrainingDatasetFolderPrefix(decoded);
    if (!folderPrefix) {
      return res.status(400).json({
        error: 'folderPrefix query must be a training dataset folder under the configured root (URL-encoded).',
      });
    }

    let keys = await collectAllObjectKeysUnderPrefix(folderPrefix);
    const baseLen = folderPrefix.length;
    keys = keys.filter((key) => {
      const rel = key.startsWith(folderPrefix) ? key.slice(baseLen) : key;
      return shouldIncludeKeyInRawTrainingZipExport(rel, key);
    });
    let truncated = false;
    if (keys.length > TRAINING_DATASET_EXPORT_MAX_OBJECTS) {
      keys = keys.slice(0, TRAINING_DATASET_EXPORT_MAX_OBJECTS);
      truncated = true;
    }

    if (keys.length === 0) {
      return res.status(404).json({
        error:
          'No raw meter images to export under this pipeline (need copied sessions with full-frame photos such as original.jpg, and dataset.json). Dial-only copies are excluded.',
      });
    }

    const slug = folderPrefix
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean)
      .pop()
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `training-dataset-${slug || 'export'}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Object-Count', String(keys.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const usedFlatZipNames = new Set();
    const allocFlatZipName = (wanted) => {
      let name = wanted;
      let n = 0;
      while (usedFlatZipNames.has(name)) {
        n += 1;
        const dot = wanted.lastIndexOf('.');
        if (dot > 0) {
          name = `${wanted.slice(0, dot)}_${n}${wanted.slice(dot)}`;
        } else {
          name = `${wanted}_${n}`;
        }
      }
      usedFlatZipNames.add(name);
      return name;
    };

    for (const key of keys) {
      const rel = key.startsWith(folderPrefix) ? key.slice(baseLen) : key;
      if (!rel || rel.endsWith('/')) continue;
      try {
        const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        if (obj.Body) {
          const buf = await streamToBuffer(obj.Body);
          if (buf && buf.length) {
            const flatName = allocFlatZipName(flatZipEntryNameForTrainingExport(rel));
            archive.append(buf, { name: flatName });
          }
        }
      } catch (e) {
        console.warn(`training-dataset-zip skip ${key}:`, e.message);
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error('training-dataset-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

// Verify Firebase email link and issue a custom token (bypasses MFA)
app.post('/api/auth/verify-email-link', async (req, res) => {
  const { email, oobCode } = req.body;
  if (!email || !oobCode) return res.status(400).json({ error: 'Email and oobCode are required' });
  if (!FIREBASE_API_KEY) return res.status(503).json({ error: 'Firebase API key not configured' });

  try {
    // Verify the oobCode by calling Firebase's REST API
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, oobCode }),
      }
    );
    const verifyData = await verifyRes.json();

    // Either success or MFA-required means the oobCode was valid
    const isValid = verifyData.localId || (verifyData.error?.message || '').startsWith('MULTI_FACTOR_AUTH_REQUIRED');
    if (!isValid) {
      console.error('Email link verification failed:', verifyData.error?.message);
      return res.status(400).json({ error: 'Invalid or expired email link. Please request a new one.' });
    }

    // oobCode is valid — create a custom token for this user
    const user = await admin.auth().getUserByEmail(email);
    const customToken = await admin.auth().createCustomToken(user.uid);
    console.log(`✅ Email link verified for ${email}, issuing custom token`);
    res.json({ success: true, customToken });
  } catch (err) {
    console.error('Email link verification error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/** Manual pipeline / model iteration rows (stored in S3 JSON). */
app.get('/api/pipeline-iterations', async (req, res) => {
  try {
    const data = await readPipelineIterationsDoc();
    const rawList = Array.isArray(data.iterations) ? data.iterations : [];
    const iterations = rawList.map((r) =>
      normalizePipelineIterationRow(
        r,
        typeof r?.id === 'string' && r.id.trim() ? r.id.trim() : randomUUID(),
      ),
    );
    res.json({
      iterations,
      updatedAt: data.updatedAt ?? null,
      updatedBy: data.updatedBy ?? null,
    });
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return res.json({ iterations: [], updatedAt: null, updatedBy: null });
    }
    console.error('GET /api/pipeline-iterations:', e);
    res.status(500).json({ error: e.message || 'Failed to read pipeline iterations' });
  }
});

/**
 * Upload .pt weights for a pipeline iteration (dial_detection or keypoint).
 * Multipart: iterationId, role (dial_detection | keypoint), file (.pt).
 */
app.post('/api/pipeline-iterations/weights', weightsUploadMiddleware, async (req, res) => {
  try {
    const iterationId = String(req.body?.iterationId ?? '').trim();
    const role = parseIterationWeightRole(req.body?.role);
    if (!iterationId) {
      return res.status(400).json({ error: 'iterationId is required.' });
    }
    if (!role) {
      return res.status(400).json({ error: 'role must be dial_detection or keypoint.' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Missing file field "file" with a non-empty .pt body.' });
    }
    const orig = String(req.file.originalname || '').trim().toLowerCase();
    if (!orig.endsWith('.pt')) {
      return res.status(400).json({ error: 'File must use a .pt extension.' });
    }

    const weights = await putPipelineIterationWeightBuffer(iterationId, role, req.file.buffer, {
      originalFileName: String(req.file.originalname || '').trim() || undefined,
      source: 'upload',
      pipeline: req.body?.pipeline,
      iterationNumber: req.body?.iterationNumber,
      modelId: req.body?.modelId,
      iterationFolder: req.body?.iterationFolder ?? req.body?.iterationName,
    });
    res.status(201).json({ ok: true, role, weights });
  } catch (e) {
    console.error('POST /api/pipeline-iterations/weights:', e);
    res.status(500).json({ error: e.message || 'Weights upload failed' });
  }
});

/**
 * Pull trained weights from Roboflow export API → S3 for this iteration.
 * Body: { iterationId, role, datasetSlug?, version?, format? }
 * Uses linked roboflow metadata when datasetSlug/version omitted.
 */
app.post('/api/pipeline-iterations/weights/from-roboflow', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const iterationId = String(body.iterationId ?? '').trim();
    const role = parseIterationWeightRole(body.role);
    if (!iterationId) {
      return res.status(400).json({ error: 'iterationId is required.' });
    }
    if (!role) {
      return res.status(400).json({ error: 'role must be dial_detection or keypoint.' });
    }

    let datasetSlug = String(body.datasetSlug ?? body.dataset_slug ?? '').trim();
    let version = body.version ?? body.version_number;
    if (!datasetSlug || version === undefined || version === null || version === '') {
      const links = body.roboflowLinks ?? body.roboflow_links;
      const link =
        role === 'dial_detection'
          ? links?.dialDetection ?? links?.dial_detection
          : links?.keypoint;
      if (!datasetSlug) datasetSlug = String(link?.datasetSlug ?? link?.dataset_slug ?? '').trim();
      if (version === undefined || version === null || version === '') {
        version = link?.version ?? link?.version_number;
      }
    }
    const ver = parseInt(String(version ?? ''), 10);
    if (!datasetSlug) {
      return res.status(400).json({
        error: 'Link a Roboflow project for this role or pass datasetSlug in the body.',
      });
    }
    if (!Number.isFinite(ver) || ver < 1) {
      return res.status(400).json({ error: 'A positive Roboflow version number is required.' });
    }

    const format = body.format ? String(body.format).trim() : undefined;
    const pulled = await pullWeightsPtFromRoboflow({ datasetSlug, version: ver, format });
    const weights = await putPipelineIterationWeightBuffer(iterationId, role, pulled.buffer, {
      originalFileName: pulled.fileName,
      source: 'roboflow',
      roboflowFormat: pulled.format,
      pipeline: body.pipeline,
      iterationNumber: body.iterationNumber,
      modelId: body.modelId,
      iterationFolder: body.iterationFolder ?? body.iterationName,
    });
    res.status(201).json({
      ok: true,
      role,
      weights,
      roboflow: {
        format: pulled.format,
        exportLink: pulled.exportLink,
        modelTypeDisplay: pulled.trainMeta?.modelTypeDisplay ?? null,
        modelType: pulled.trainMeta?.modelType ?? null,
      },
    });
  } catch (e) {
    console.error('POST /api/pipeline-iterations/weights/from-roboflow:', e);
    res.status(500).json({ error: e.message || 'Roboflow weights pull failed' });
  }
});

/** Signed download URL for iteration weights on S3. Query: iterationId, role */
app.get('/api/pipeline-iterations/weights-signed-url', async (req, res) => {
  try {
    const iterationId = String(req.query.iterationId ?? '').trim();
    const role = parseIterationWeightRole(req.query.role);
    if (!iterationId || !role) {
      return res.status(400).json({ error: 'iterationId and role (dial_detection | keypoint) are required.' });
    }
    const folderName = await resolveIterationWeightsFolder(iterationId, {
      iterationFolder: req.query.iterationFolder ?? req.query.iterationName,
      pipeline: req.query.pipeline,
      iterationNumber: req.query.iterationNumber,
      modelId: req.query.modelId,
    });
    const key = iterationWeightS3Key(folderName, role);
    if (!key) return res.status(400).json({ error: 'Invalid iteration folder name.' });

    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    } catch {
      return res.status(404).json({ error: 'No weights uploaded for this iteration and role yet.' });
    }

    const expiresIn = Math.min(
      86400,
      Math.max(60, parseInt(process.env.TRAINING_WEIGHTS_SIGNED_URL_TTL_SEC || '3600', 10) || 3600),
    );
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    res.json({ url, expiresInSeconds: expiresIn, bucket: BUCKET_NAME, key });
  } catch (e) {
    console.error('GET /api/pipeline-iterations/weights-signed-url:', e);
    res.status(500).json({ error: e.message || 'Signed URL failed' });
  }
});

app.put('/api/pipeline-iterations', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawList = body.iterations;
    if (!Array.isArray(rawList)) {
      return res.status(400).json({ error: 'Body must include iterations array' });
    }
    const prevDoc = await readPipelineIterationsDoc();
    const prevById = new Map();
    for (const pr of Array.isArray(prevDoc.iterations) ? prevDoc.iterations : []) {
      if (pr?.id) prevById.set(String(pr.id), pr);
    }
    const saveNow = new Date().toISOString();
    const iterations = rawList.map((r) => {
      const row = normalizePipelineIterationRow(r, randomUUID());
      const prev = prevById.get(row.id);
      const clientUpdated = String(r?.updatedAt ?? r?.updated_at ?? '').trim();
      if (clientUpdated && Number.isFinite(Date.parse(clientUpdated))) {
        row.updatedAt = clientUpdated;
      } else if (!prev) {
        row.updatedAt = saveNow;
      } else if (iterationRowContentFingerprint(prev) !== iterationRowContentFingerprint(row)) {
        row.updatedAt = saveNow;
      } else {
        row.updatedAt = prev.updatedAt || row.updatedAt || null;
      }
      return row;
    });
    const err = validatePipelineIterationsPayload(iterations);
    if (err) return res.status(400).json({ error: err });

    const updatedBy = String(req.headers['x-user-email'] || '').trim();
    const doc = {
      iterations,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    const key = pipelineIterationsS3Key();
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(doc, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
    res.json(doc);
  } catch (e) {
    console.error('PUT /api/pipeline-iterations:', e);
    res.status(500).json({ error: e.message || 'Failed to save pipeline iterations' });
  }
});

registerApiDocs(app);

/**
 * SPA fallback — must not return HTML for `/api/*` or the client shows "API returned HTML instead of JSON"
 * (e.g. old Node process without a newer route, or typo). Unknown API routes get JSON 404 instead.
 */
app.get('/{*path}', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: `No API route for ${req.method} ${req.path}. Restart the Node server after updating so new endpoints are registered.`,
    });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(
    `📈 Analytics: s3://${ANALYTICS_BUCKET_NAME}/${ANALYTICS_KEY_PREFIX ? `${ANALYTICS_KEY_PREFIX}/` : ''}improvement/…`,
  );
  console.log(`🌎 Region: ${REGION}`);
  await improvementAnalytics.ensureBucketExists();
  try {
    const probe = await improvementAnalytics.readIndex('all', '1000');
    const n = Object.keys(probe.sessions || {}).length;
    console.log(`📈 Improvement index probe: ${n} session(s) indexed`);
  } catch (err) {
    console.warn(`📈 Improvement index probe failed: ${err.message}`);
  }
  console.log(`📂 S3 base prefix: ${S3_BASE_PREFIX || '(none — keys at bucket root)'}`);
  console.log(`📋 Work Types: ${WORK_TYPES.join(', ')}`);
  console.log(`🔎 S3 layout debug: GET http://localhost:${PORT}/api/s3-discover`);
  console.log(`📖 API docs (Swagger): http://localhost:${PORT}/api/docs`);
  await loadActivityLog();
  console.log('');
});
