/**
 * Roboflow integration — server-side only (API key never sent to the browser).
 * @see https://docs.roboflow.com/developer/rest-api
 * @see https://docs.roboflow.com/developer/rest-api/manage-images/upload-an-image
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { fetchRoboflowVersionDetail } from './roboflowWeights.js';

/** Read at call time — `src/.env` is loaded in index.js after ES module imports are linked. */
function roboflowApiKey() {
  return String(process.env.ROBOFLOW_API_KEY || '').trim();
}

function roboflowWorkspaceEnv() {
  return String(process.env.ROBOFLOW_WORKSPACE || '').trim();
}

let cachedWorkspace = null;
let cachedWorkspaceAt = 0;
const WORKSPACE_CACHE_MS = 5 * 60 * 1000;

function isConfigured() {
  return Boolean(roboflowApiKey());
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function resolveWorkspaceSlug() {
  const fromEnv = roboflowWorkspaceEnv();
  if (fromEnv) return fromEnv;
  if (!isConfigured()) return null;
  if (cachedWorkspace && Date.now() - cachedWorkspaceAt < WORKSPACE_CACHE_MS) {
    return cachedWorkspace;
  }
  const url = `https://api.roboflow.com/?api_key=${encodeURIComponent(roboflowApiKey())}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Roboflow root auth failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const ws = data.workspace || data.name;
  if (!ws) throw new Error('Roboflow response did not include a workspace id');
  cachedWorkspace = ws;
  cachedWorkspaceAt = Date.now();
  return ws;
}

/** Roboflow often returns slug as `workspace/project` already — avoid doubling the workspace. */
function normalizeDatasetSlug(workspaceSlug, slugOrId) {
  const raw = String(slugOrId || '').trim().replace(/^\/+/, '');
  if (!raw) return raw;
  const ws = String(workspaceSlug || '').trim();
  const parts = raw.split('/').filter(Boolean);
  if (parts.length >= 3 && ws && parts[0] === ws && parts[1] === ws) {
    return parts.slice(1).join('/');
  }
  if (parts.length >= 2 && ws && parts[0] === ws) {
    return parts.join('/');
  }
  if (ws) return `${ws}/${raw}`;
  return raw;
}

export function normalizeRoboflowDatasetSlugParam(datasetSlug, workspaceFallback) {
  const raw = String(datasetSlug || '').trim();
  if (!raw) return raw;
  const parts = raw.split('/').filter(Boolean);
  const ws = parts[0] || workspaceFallback || '';
  return normalizeDatasetSlug(ws, raw);
}

function extractProjects(workspaceJson, workspaceSlug) {
  const raw =
    workspaceJson.projects
    || workspaceJson.workspace?.projects
    || (Array.isArray(workspaceJson) ? workspaceJson : null)
    || [];
  return raw.map((p) => {
    const slug = p.slug || p.id || p.name;
    const datasetSlug = normalizeDatasetSlug(workspaceSlug, slug);
    return {
      name: p.name || p.title || slug || 'Project',
      slug,
      datasetSlug,
      type: p.type || null,
      url: p.url || (datasetSlug ? `https://app.roboflow.com/${datasetSlug}` : null),
      annotateUrl: datasetSlug ? `https://app.roboflow.com/${datasetSlug}/annotate` : null,
    };
  });
}

function parseVersionNumberFromEntry(v) {
  const id = v.id ?? v.version ?? v.number;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const str = String(id ?? '').trim();
  if (!str) return null;
  const tail = str.includes('/') ? str.split('/').pop() : str;
  const n = parseInt(String(tail ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function extractProjectVersions(projectJson) {
  // `project.versions` is a count; the version list lives in top-level `versions[]`.
  const raw =
    (Array.isArray(projectJson.versions) ? projectJson.versions : null)
    || (Array.isArray(projectJson.project?.versionList) ? projectJson.project.versionList : null)
    || (projectJson.project?.version && typeof projectJson.project.version === 'object'
      ? [projectJson.project.version]
      : null)
    || [];
  return raw
    .map((v) => {
      const model = v.model && typeof v.model === 'object' ? v.model : null;
      const mapRaw = model?.map ?? v.map ?? v.accuracy;
      const map =
        mapRaw === null || mapRaw === undefined || mapRaw === ''
          ? null
          : typeof mapRaw === 'number'
            ? mapRaw
            : parseFloat(String(mapRaw));
      return {
        version: parseVersionNumberFromEntry(v),
        name: v.name || v.note || null,
        created: v.created || v.created_at || v.date || null,
        trainImages: v.images ?? v.train_images ?? v.train ?? null,
        map: Number.isFinite(map) ? map : null,
        precision: model?.precision != null ? parseFloat(String(model.precision)) : null,
        recall: model?.recall != null ? parseFloat(String(model.recall)) : null,
        hasTrainedModel: Boolean(model?.id || model?.endpoint),
        modelId: model?.id ? String(model.id) : null,
        modelUpdated: model?.end ?? model?.updated ?? null,
      };
    })
    .filter((v) => v.version != null)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
}

function extractProjectImageCounts(projectJson) {
  const p = projectJson.project || projectJson;
  const splits = p.splits || p.images || {};
  const num = (v) => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    total: num(p.images ?? p.total_images ?? splits.total),
    train: num(splits.train ?? p.train),
    valid: num(splits.valid ?? splits.validation ?? p.valid),
    test: num(splits.test ?? p.test),
  };
}

async function fetchWorkspacePayload() {
  const ws = await resolveWorkspaceSlug();
  const url = `https://api.roboflow.com/${encodeURIComponent(ws)}?api_key=${encodeURIComponent(roboflowApiKey())}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Roboflow workspace response was not JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(json.error || json.message || `Roboflow workspace HTTP ${res.status}`);
  }
  return { workspaceSlug: ws, json };
}

async function findReadingBySessionId(getAllReadings, WORK_TYPES, sessionId, preferredWorkType) {
  const order = preferredWorkType
    ? [preferredWorkType, ...WORK_TYPES.filter((w) => w !== preferredWorkType)]
    : [...WORK_TYPES];
  for (const wt of order) {
    const readings = await getAllReadings('all', wt);
    const hit = readings.find((r) => r.id === sessionId);
    if (hit) return { reading: hit, workType: wt };
  }
  return null;
}

function guessContentType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * @param {import('express').Express} app
 * @param {{ WORK_TYPES: string[], getAllReadings: Function, s3Client: import('@aws-sdk/client-s3').S3Client, BUCKET_NAME: string }} deps
 */
export function registerRoboflowRoutes(app, deps) {
  const { WORK_TYPES, getAllReadings, s3Client, BUCKET_NAME } = deps;

  app.get('/api/roboflow/status', async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.json({ configured: false, workspace: null });
      }
      const workspace = await resolveWorkspaceSlug();
      res.json({ configured: true, workspace });
    } catch (e) {
      console.error('Roboflow status:', e.message);
      res.status(503).json({ configured: false, workspace: null, error: e.message });
    }
  });

  app.get('/api/roboflow/projects', async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }
      const { workspaceSlug, json } = await fetchWorkspacePayload();
      const projects = extractProjects(json, workspaceSlug);
      res.json({ workspace: workspaceSlug, projects });
    } catch (e) {
      console.error('Roboflow projects:', e.message);
      res.status(502).json({ error: e.message || 'Failed to list Roboflow projects' });
    }
  });

  app.get('/api/roboflow/version', async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }
      let datasetSlug = String(req.query.dataset ?? req.query.datasetSlug ?? '').trim();
      const version = parseInt(String(req.query.version ?? ''), 10);
      if (!datasetSlug) {
        return res.status(400).json({ error: 'Query dataset (workspace/project) is required.' });
      }
      if (!Number.isFinite(version) || version < 1) {
        return res.status(400).json({ error: 'Query version must be a positive integer.' });
      }
      const { workspaceSlug } = await fetchWorkspacePayload().catch(() => ({ workspaceSlug: '' }));
      datasetSlug = normalizeRoboflowDatasetSlugParam(
        datasetSlug,
        workspaceSlug || roboflowWorkspaceEnv(),
      );
      const detail = await fetchRoboflowVersionDetail({ datasetSlug, version });
      res.json(detail);
    } catch (e) {
      console.error('Roboflow version meta:', e.message);
      res.status(502).json({ error: e.message || 'Failed to load version metadata' });
    }
  });

  app.get('/api/roboflow/project', async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }
      let datasetSlug = String(req.query.dataset ?? req.query.datasetSlug ?? '').trim();
      if (!datasetSlug) {
        return res.status(400).json({ error: 'Query dataset (workspace/project) is required.' });
      }
      const { workspaceSlug } = await fetchWorkspacePayload().catch(() => ({ workspaceSlug: '' }));
      datasetSlug = normalizeRoboflowDatasetSlugParam(
        datasetSlug,
        workspaceSlug || roboflowWorkspaceEnv(),
      );
      const parts = datasetSlug.split('/').filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: 'dataset must be workspace/project' });
      }
      const ws = parts[0];
      const projectSlug = parts.slice(1).join('/');
      const url = `https://api.roboflow.com/${encodeURIComponent(ws)}/${encodeURIComponent(projectSlug)}?api_key=${encodeURIComponent(roboflowApiKey())}`;
      const rfRes = await fetch(url);
      const text = await rfRes.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Roboflow project response was not JSON (${rfRes.status})`);
      }
      if (!rfRes.ok) {
        throw new Error(json.error || json.message || `Roboflow HTTP ${rfRes.status}`);
      }
      const versions = extractProjectVersions(json);
      const trainedModels = versions.filter((v) => v.hasTrainedModel);
      const imageCounts = extractProjectImageCounts(json);
      res.json({
        workspace: ws,
        projectSlug,
        datasetSlug: `${ws}/${projectSlug}`,
        name: json.project?.name || json.name || projectSlug,
        type: json.project?.type || json.type || null,
        imageCounts,
        versions,
        trainedModels,
        versionCount: json.project?.versions ?? versions.length,
        annotateUrl: `https://app.roboflow.com/${encodeURIComponent(ws)}/${encodeURIComponent(projectSlug)}/annotate`,
        modelsUrl: `https://app.roboflow.com/${encodeURIComponent(ws)}/${encodeURIComponent(projectSlug)}/models`,
        url: `https://app.roboflow.com/${encodeURIComponent(ws)}/${encodeURIComponent(projectSlug)}`,
      });
    } catch (e) {
      console.error('Roboflow project detail:', e.message);
      res.status(502).json({ error: e.message || 'Failed to load Roboflow project' });
    }
  });

  app.post('/api/roboflow/upload-from-session', async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'Roboflow is not configured (set ROBOFLOW_API_KEY on the server).' });
      }

      const {
        sessionId,
        workType: bodyWorkType,
        dataset,
        split = 'train',
        batch,
        imageScope = 'original',
      } = req.body || {};

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'sessionId is required' });
      }
      if (!dataset || typeof dataset !== 'string' || !dataset.includes('/')) {
        return res.status(400).json({
          error: 'dataset is required as workspace/project (e.g. my-workspace/meter-readings).',
        });
      }

      const datasetSegments = dataset.split('/').filter(Boolean);
      if (datasetSegments.length < 2) {
        return res.status(400).json({ error: 'dataset must include workspace and project (workspace/project).' });
      }
      const datasetPath = datasetSegments.map(encodeURIComponent).join('/');

      const found = await findReadingBySessionId(
        getAllReadings,
        WORK_TYPES,
        sessionId,
        bodyWorkType || '1000',
      );
      if (!found) {
        return res.status(404).json({ error: 'Reading not found in S3 index for any work type' });
      }

      const { reading } = found;
      let images = reading.images || [];
      if (imageScope === 'original') {
        images = images.filter((im) => im.fileName === 'original.jpg' || im.label === 'Full Meter View');
      }
      if (images.length === 0) {
        return res.status(400).json({ error: 'No images matched the requested scope for this session.' });
      }

      const batchName = batch || `portal-s3-${sessionId}`;
      const results = [];

      for (const im of images) {
        const key = im.id;
        if (!key || typeof key !== 'string') continue;

        let buffer;
        try {
          const obj = await s3Client.send(
            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
          );
          buffer = await streamToBuffer(obj.Body);
        } catch (err) {
          results.push({ key, ok: false, error: err.message || 'S3 read failed' });
          continue;
        }

        const fileName = im.fileName || key.split('/').pop() || 'image.jpg';
        const form = new FormData();
        form.append('name', fileName);
        form.append('split', split);
        form.append('file', new Blob([buffer], { type: guessContentType(fileName) }), fileName);
        form.append('batch', batchName);

        const uploadUrl = `https://api.roboflow.com/dataset/${datasetPath}/upload?api_key=${encodeURIComponent(roboflowApiKey())}`;

        try {
          const rfRes = await fetch(uploadUrl, { method: 'POST', body: form });
          const text = await rfRes.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
          if (!rfRes.ok) {
            results.push({
              key,
              ok: false,
              error: data.error || data.message || text.slice(0, 300) || `HTTP ${rfRes.status}`,
            });
          } else {
            results.push({ key, ok: true, roboflow: data });
          }
        } catch (err) {
          results.push({ key, ok: false, error: err.message || 'Upload request failed' });
        }
      }

      const uploaded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      const workspaceSlug = datasetSegments[0];
      const projectSlug = datasetSegments.slice(1).join('/');
      const annotateUrl = `https://app.roboflow.com/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(projectSlug)}/annotate`;

      res.json({
        success: failed === 0,
        uploaded,
        failed,
        batch: batchName,
        annotateUrl,
        results,
      });
    } catch (e) {
      console.error('Roboflow upload:', e.message);
      res.status(500).json({ error: e.message || 'Upload failed' });
    }
  });
}
