/**
 * Portal training datasets → Roboflow project create + original.jpg sync.
 * Separate from iteration `roboflowLinks` (trained model versions after training).
 */

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  createRoboflowProject,
  DEFAULT_ROBOFLOW_ANNOTATION,
  isRoboflowConfigured,
  normalizeRoboflowAnnotation,
  uploadImageBufferToRoboflowDataset,
} from './roboflow.js';

/** Roboflow REST create-project only supports detection/segmentation/classification types. */
export const TRAINING_DATASET_ROBOFLOW_TYPES = [{ id: 'object-detection', label: 'Object detection' }];

/** Portal create-project is off until keypoint-detection works on Roboflow REST create. Set env to "true" to re-enable. */
export function isTrainingDatasetRoboflowCreateEnabled() {
  const v = String(process.env.TRAINING_DATASET_ROBOFLOW_CREATE_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export const TRAINING_DATASET_ROBOFLOW_CREATE_DISABLED_MESSAGE =
  'Creating Roboflow projects from the portal is disabled (keypoint-detection required). Create in Roboflow app and link later, or set TRAINING_DATASET_ROBOFLOW_CREATE_ENABLED=true when supported.';

export function normalizeTrainingDatasetRoboflowTraining(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const datasetSlug = String(raw.datasetSlug ?? raw.dataset_slug ?? '').trim();
  if (!datasetSlug) return null;
  const workspaceSlug = String(raw.workspaceSlug ?? raw.workspace_slug ?? '').trim() || null;
  const projectSlug = String(raw.projectSlug ?? raw.project_slug ?? '').trim() || null;
  return {
    projectName: String(raw.projectName ?? raw.project_name ?? '').trim() || null,
    projectType: String(raw.projectType ?? raw.project_type ?? '').trim() || null,
    annotation: String(raw.annotation ?? '').trim() || DEFAULT_ROBOFLOW_ANNOTATION,
    datasetSlug,
    workspaceSlug,
    projectSlug,
    annotateUrl: String(raw.annotateUrl ?? raw.annotate_url ?? '').trim() || null,
    url: String(raw.url ?? '').trim() || null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? '').trim() || null,
    lastSyncAt: String(raw.lastSyncAt ?? raw.last_sync_at ?? '').trim() || null,
    lastSyncUploaded:
      raw.lastSyncUploaded != null && Number.isFinite(Number(raw.lastSyncUploaded))
        ? Number(raw.lastSyncUploaded)
        : null,
    lastSyncFailed:
      raw.lastSyncFailed != null && Number.isFinite(Number(raw.lastSyncFailed))
        ? Number(raw.lastSyncFailed)
        : null,
    lastSyncBatch: String(raw.lastSyncBatch ?? raw.last_sync_batch ?? '').trim() || null,
  };
}

export function normalizePipelineIterationTrainingDatasetLinks(raw) {
  const fromArray = raw?.linkedTrainingDatasets ?? raw?.linked_training_datasets;
  if (!Array.isArray(fromArray)) return [];
  const out = [];
  for (const item of fromArray) {
    if (!item || typeof item !== 'object') continue;
    const folderPrefix = String(item.folderPrefix ?? item.folder_prefix ?? '').trim();
    if (!folderPrefix || folderPrefix.includes('..')) continue;
    out.push({
      folderPrefix,
      displayName: String(item.displayName ?? item.display_name ?? '').trim() || null,
      linkedAt: String(item.linkedAt ?? item.linked_at ?? '').trim() || null,
      roboflowTraining: normalizeTrainingDatasetRoboflowTraining(
        item.roboflowTraining ?? item.roboflow_training,
      ),
    });
  }
  return out;
}

function trainingDatasetRoboflowSummary(manifest, rf) {
  if (!rf) return null;
  return {
    projectName: rf.projectName,
    projectType: rf.projectType,
    annotation: rf.annotation,
    datasetSlug: rf.datasetSlug,
    workspaceSlug: rf.workspaceSlug,
    projectSlug: rf.projectSlug,
    annotateUrl: rf.annotateUrl,
    url: rf.url,
    createdAt: rf.createdAt,
    lastSyncAt: rf.lastSyncAt,
    lastSyncUploaded: rf.lastSyncUploaded,
    lastSyncFailed: rf.lastSyncFailed,
  };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Collect `original.jpg` keys under `{folderPrefix}sessions/{sessionId}/`.
 */
export async function collectTrainingDatasetOriginalImageKeys(s3Client, bucket, folderPrefix) {
  const norm = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;
  const sessionsRoot = `${norm}sessions/`;
  const keys = [];
  let token;
  do {
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: sessionsRoot,
        Delimiter: '/',
        ContinuationToken: token,
        MaxKeys: 500,
      }),
    );
    const prefixes = (out.CommonPrefixes || []).map((p) => p.Prefix).filter(Boolean);
    for (const pref of prefixes) {
      const r2 = await s3Client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: pref, MaxKeys: 40 }),
      );
      const sessionKeys = (r2.Contents || []).map((c) => c.Key).filter(Boolean);
      const original = sessionKeys.find((k) => (k.split('/').pop() || '').toLowerCase() === 'original.jpg');
      if (original) {
        const parts = pref.replace(/\/$/, '').split('/');
        const sessionId = parts[parts.length - 1] || 'session';
        keys.push({ s3Key: original, sessionId });
      }
    }
    token = out.NextContinuationToken;
  } while (token);
  return keys;
}

/**
 * @param {{ manifest: object, projectName: string, projectType: string, annotation?: string }} opts
 */
export async function createRoboflowProjectForTrainingManifest(opts) {
  const projectType = String(opts.projectType || 'object-detection').trim();
  if (projectType !== 'object-detection') {
    throw new Error(
      'Only object-detection can be created from a training dataset. Link existing keypoint projects under Model Factory → Roboflow.',
    );
  }
  const annotation = normalizeRoboflowAnnotation(opts.annotation);
  const created = await createRoboflowProject({
    name: opts.projectName,
    type: projectType,
    annotation,
  });
  const rf = {
    projectName: created.projectName,
    projectType: created.projectType,
    annotation: created.annotation || annotation,
    datasetSlug: created.datasetSlug,
    workspaceSlug: created.workspaceSlug,
    projectSlug: created.projectSlug,
    annotateUrl: created.annotateUrl,
    url: created.url,
    createdAt: created.createdAt,
    lastSyncAt: null,
    lastSyncUploaded: null,
    lastSyncFailed: null,
    lastSyncBatch: null,
  };
  opts.manifest.roboflowTraining = rf;
  return { roboflowTraining: rf, created };
}

const SYNC_MAX_IMAGES = parseInt(process.env.TRAINING_DATASET_ROBOFLOW_SYNC_MAX || '400', 10) || 400;

/**
 * @param {{ s3Client, bucket: string, folderPrefix: string, manifest: object, split?: string }} opts
 */
export async function syncTrainingDatasetOriginalsToRoboflow(opts) {
  const rf = normalizeTrainingDatasetRoboflowTraining(opts.manifest.roboflowTraining);
  if (!rf?.datasetSlug) {
    throw new Error('No Roboflow project linked on this training dataset. Create a project first.');
  }

  const images = await collectTrainingDatasetOriginalImageKeys(
    opts.s3Client,
    opts.bucket,
    opts.folderPrefix,
  );
  if (images.length === 0) {
    throw new Error('No original.jpg files under sessions/ — copy meter sessions into this training dataset first.');
  }
  if (images.length > SYNC_MAX_IMAGES) {
    throw new Error(`Too many sessions (${images.length}); max ${SYNC_MAX_IMAGES} per sync. Split the dataset or raise TRAINING_DATASET_ROBOFLOW_SYNC_MAX.`);
  }

  const slug = String(opts.manifest.slug || 'dataset').slice(0, 40);
  const batch = `portal-training-${slug}-${Date.now()}`;
  const split = String(opts.split || 'train').trim() || 'train';
  const results = [];

  for (const { s3Key, sessionId } of images) {
    try {
      const obj = await opts.s3Client.send(
        new GetObjectCommand({ Bucket: opts.bucket, Key: s3Key }),
      );
      const buffer = await streamToBuffer(obj.Body);
      const fileName = `${sessionId}_original.jpg`;
      await uploadImageBufferToRoboflowDataset({
        datasetPath: rf.datasetSlug,
        buffer,
        fileName,
        split,
        batch,
      });
      results.push({ sessionId, s3Key, ok: true });
    } catch (err) {
      results.push({ sessionId, s3Key, ok: false, error: err.message || String(err) });
    }
  }

  const uploaded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const now = new Date().toISOString();

  opts.manifest.roboflowTraining = {
    ...rf,
    lastSyncAt: now,
    lastSyncUploaded: uploaded,
    lastSyncFailed: failed,
    lastSyncBatch: batch,
  };

  return {
    success: failed === 0,
    uploaded,
    failed,
    batch,
    annotateUrl: rf.annotateUrl,
    results,
    roboflowTraining: opts.manifest.roboflowTraining,
  };
}

export function trainingDatasetLinkFromManifest(manifest) {
  const folderPrefix = String(manifest.folderPrefix || '').trim();
  if (!folderPrefix) return null;
  return {
    folderPrefix,
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : null,
    linkedAt: new Date().toISOString(),
    roboflowTraining: trainingDatasetRoboflowSummary(manifest, manifest.roboflowTraining),
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ s3Client, BUCKET_NAME: string, normalizeTrainingDatasetFolderPrefix: Function, readTrainingDatasetManifest: Function, writeTrainingDatasetManifest: Function }} deps
 */
export function registerTrainingDatasetRoboflowRoutes(app, deps) {
  const { s3Client, BUCKET_NAME, normalizeTrainingDatasetFolderPrefix, readTrainingDatasetManifest, writeTrainingDatasetManifest } =
    deps;

  app.get('/api/training-datasets/roboflow/types', (_req, res) => {
    res.json({
      types: TRAINING_DATASET_ROBOFLOW_TYPES,
      configured: isRoboflowConfigured(),
      createEnabled: isTrainingDatasetRoboflowCreateEnabled(),
    });
  });

  app.post('/api/training-datasets/roboflow/create-project', async (req, res) => {
    try {
      if (!isTrainingDatasetRoboflowCreateEnabled()) {
        return res.status(503).json({ error: TRAINING_DATASET_ROBOFLOW_CREATE_DISABLED_MESSAGE });
      }
      if (!isRoboflowConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }
      const folderPrefix = normalizeTrainingDatasetFolderPrefix(req.body?.folderPrefix);
      if (!folderPrefix) {
        return res.status(400).json({ error: 'folderPrefix must be a training dataset folder under the configured root.' });
      }
      let manifest;
      try {
        manifest = await readTrainingDatasetManifest(folderPrefix);
      } catch {
        return res.status(404).json({ error: 'dataset.json not found for this training dataset.' });
      }

      const projectName =
        typeof req.body?.projectName === 'string' && req.body.projectName.trim()
          ? req.body.projectName.trim()
          : String(manifest.displayName || 'Training dataset').trim();
      const projectType = String(req.body?.projectType || req.body?.type || 'object-detection').trim();
      const annotation =
        typeof req.body?.annotation === 'string' && req.body.annotation.trim()
          ? req.body.annotation
          : DEFAULT_ROBOFLOW_ANNOTATION;

      const { roboflowTraining } = await createRoboflowProjectForTrainingManifest({
        manifest,
        projectName,
        projectType,
        annotation,
      });
      await writeTrainingDatasetManifest(folderPrefix, manifest);

      res.status(201).json({
        ok: true,
        folderPrefix,
        roboflowTraining,
        displayName: manifest.displayName,
      });
    } catch (e) {
      console.error('training-datasets roboflow create-project:', e);
      res.status(502).json({ error: e.message || 'Failed to create Roboflow project' });
    }
  });

  app.post('/api/training-datasets/roboflow/sync', async (req, res) => {
    try {
      if (!isRoboflowConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }
      const folderPrefix = normalizeTrainingDatasetFolderPrefix(req.body?.folderPrefix);
      if (!folderPrefix) {
        return res.status(400).json({ error: 'folderPrefix must be a training dataset folder under the configured root.' });
      }
      let manifest;
      try {
        manifest = await readTrainingDatasetManifest(folderPrefix);
      } catch {
        return res.status(404).json({ error: 'dataset.json not found for this training dataset.' });
      }

      const split = typeof req.body?.split === 'string' ? req.body.split : 'train';
      const result = await syncTrainingDatasetOriginalsToRoboflow({
        s3Client,
        bucket: BUCKET_NAME,
        folderPrefix,
        manifest,
        split,
      });
      await writeTrainingDatasetManifest(folderPrefix, manifest);

      res.json({
        ok: true,
        folderPrefix,
        ...result,
      });
    } catch (e) {
      console.error('training-datasets roboflow sync:', e);
      res.status(502).json({ error: e.message || 'Roboflow sync failed' });
    }
  });
}
