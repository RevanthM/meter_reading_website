/**
 * Roboflow integration — server-side only (API key never sent to the browser).
 * @see https://docs.roboflow.com/developer/rest-api
 * @see https://docs.roboflow.com/developer/rest-api/manage-images/upload-an-image
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || '';
const ROBOFLOW_WORKSPACE = (process.env.ROBOFLOW_WORKSPACE || '').trim();

let cachedWorkspace = null;
let cachedWorkspaceAt = 0;
const WORKSPACE_CACHE_MS = 5 * 60 * 1000;

function isConfigured() {
  return Boolean(ROBOFLOW_API_KEY);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function resolveWorkspaceSlug() {
  if (ROBOFLOW_WORKSPACE) return ROBOFLOW_WORKSPACE;
  if (!isConfigured()) return null;
  if (cachedWorkspace && Date.now() - cachedWorkspaceAt < WORKSPACE_CACHE_MS) {
    return cachedWorkspace;
  }
  const url = `https://api.roboflow.com/?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`;
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

function extractProjects(workspaceJson, workspaceSlug) {
  const raw =
    workspaceJson.projects
    || workspaceJson.workspace?.projects
    || (Array.isArray(workspaceJson) ? workspaceJson : null)
    || [];
  return raw.map((p) => {
    const slug = p.slug || p.id || p.name;
    const datasetSlug = slug && workspaceSlug ? `${workspaceSlug}/${slug}` : slug;
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

async function fetchWorkspacePayload() {
  const ws = await resolveWorkspaceSlug();
  const url = `https://api.roboflow.com/${encodeURIComponent(ws)}?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`;
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

        const uploadUrl = `https://api.roboflow.com/dataset/${datasetPath}/upload?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`;

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
