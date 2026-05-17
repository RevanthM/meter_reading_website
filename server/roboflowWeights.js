/**
 * Pull trained weights.pt from Roboflow (same as UI "Download Weights" / Python model.download()).
 * @see https://docs.roboflow.com/deploy/download-roboflow-model-weights
 * @see https://github.com/roboflow/roboflow-python — GET /{workspace}/{project}/{version}/ptFile → { weightsUrl }
 *
 * Dataset export (yolov5pytorch zip) is a separate, much larger download and does not include weights.pt.
 */
import { unzipSync } from 'fflate';

const EXPORT_FORMATS_FALLBACK = ['yolo26', 'yolov8', 'yolov5pytorch', 'coco'];

function roboflowApiKey() {
  return String(process.env.ROBOFLOW_API_KEY || '').trim();
}

export function parseRoboflowDatasetSlug(datasetSlug) {
  let parts = String(datasetSlug || '')
    .trim()
    .split('/')
    .filter(Boolean);
  if (parts.length >= 3 && parts[0] === parts[1]) {
    parts = parts.slice(1);
  }
  if (parts.length < 2) return null;
  return { workspace: parts[0], project: parts.slice(1).join('/') };
}

function versionApiUrl(parsed, version, suffix = '') {
  const base = `https://api.roboflow.com/${encodeURIComponent(parsed.workspace)}/${encodeURIComponent(parsed.project)}/${version}`;
  return suffix ? `${base}/${suffix}` : base;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function roboflowTimestampToIso(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof ts === 'object' && ts._seconds != null) {
    return new Date(Number(ts._seconds) * 1000).toISOString();
  }
  const d = new Date(String(ts));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize Roboflow metric to 0–100 display percent. */
function toDisplayPercent(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
}

function parseVersionDetailJson(json, datasetSlug, version) {
  const v = json.version || json;
  const train = v.train && typeof v.train === 'object' ? v.train : {};
  const model = v.model && typeof v.model === 'object' ? v.model : {};
  const splits = v.splits && typeof v.splits === 'object' ? v.splits : {};
  const results = train.results && typeof train.results === 'object' ? train.results : {};

  return {
    datasetSlug,
    version,
    versionName: v.name ? String(v.name).trim() : null,
    modelType: train.modelType || train.model || null,
    modelTypeDisplay: train.modelTypeDisplay || null,
    trainStatus: train.status ? String(train.status) : null,
    exports: Array.isArray(v.exports) ? v.exports.map(String) : [],
    hasTrainedModel: Boolean(train.model || train.modelType || model.id),
    imageCount: numOrNull(v.images),
    splits: {
      train: numOrNull(splits.train),
      valid: numOrNull(splits.valid ?? splits.validation),
      test: numOrNull(splits.test),
    },
    versionCreatedAt: roboflowTimestampToIso(v.created),
    lastTrainedAt: roboflowTimestampToIso(train.end) || roboflowTimestampToIso(model.end),
    mapPercent: toDisplayPercent(model.map) ?? toDisplayPercent(results.map),
    precisionPercent: toDisplayPercent(model.precision) ?? toDisplayPercent(results.precision),
    recallPercent: toDisplayPercent(model.recall) ?? toDisplayPercent(results.recall),
    checkpoint: train.checkpoint ? String(train.checkpoint) : null,
    modelEndpoint: model.endpoint ? String(model.endpoint) : null,
    modelId: model.id ? String(model.id) : null,
  };
}

/**
 * Full Roboflow version metadata (images, splits, train dates, metrics).
 * @param {{ datasetSlug: string, version: number }} opts
 */
export async function fetchRoboflowVersionDetail(opts) {
  const apiKey = roboflowApiKey();
  if (!apiKey) throw new Error('Roboflow is not configured.');
  const parsed = parseRoboflowDatasetSlug(opts.datasetSlug);
  if (!parsed) throw new Error('datasetSlug must be workspace/project.');
  const version = parseInt(String(opts.version ?? ''), 10);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('A positive version number is required.');
  }

  const url = `${versionApiUrl(parsed, version)}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Roboflow version response was not JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(json.error || json.message || `Roboflow HTTP ${res.status}`);
  }
  return parseVersionDetailJson(json, opts.datasetSlug.trim(), version);
}

/** @deprecated alias — use fetchRoboflowVersionDetail */
export async function fetchRoboflowVersionTrainMeta(opts) {
  const d = await fetchRoboflowVersionDetail(opts);
  return {
    modelType: d.modelType,
    modelTypeDisplay: d.modelTypeDisplay,
    trainStatus: d.trainStatus,
    exports: d.exports,
    hasTrainedModel: d.hasTrainedModel,
  };
}

/**
 * Download weights.pt via Roboflow ptFile API (premium / trained versions).
 * @param {{ datasetSlug: string, version: number, format?: string }} opts
 */
export async function pullWeightsPtFromRoboflow(opts) {
  const apiKey = roboflowApiKey();
  if (!apiKey) {
    throw new Error('Roboflow is not configured (set ROBOFLOW_API_KEY on the server).');
  }
  const parsed = parseRoboflowDatasetSlug(opts.datasetSlug);
  if (!parsed) {
    throw new Error('datasetSlug must be workspace/project (e.g. analoggasmeter/sempra_keypoint_model).');
  }
  const version = parseInt(String(opts.version ?? ''), 10);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('A positive Roboflow version number is required.');
  }

  let trainMeta = null;
  try {
    trainMeta = await fetchRoboflowVersionTrainMeta({ datasetSlug: opts.datasetSlug, version });
  } catch {
    trainMeta = null;
  }

  try {
    const pt = await pullViaPtFile(parsed, version, apiKey);
    return { ...pt, trainMeta };
  } catch (ptErr) {
    if (opts.format === 'ptFile' || opts.format === 'weights') {
      throw ptErr;
    }
    const exportFormats = opts.format
      ? [String(opts.format).trim()]
      : exportFormatsForTrainMeta(trainMeta);
    try {
      const exp = await pullViaDatasetExport(parsed, version, apiKey, exportFormats);
      return { ...exp, trainMeta };
    } catch (exportErr) {
      throw new Error(
        `${ptErr.message} Fallback dataset export also failed: ${exportErr.message}`,
      );
    }
  }
}

async function pullViaPtFile(parsed, version, apiKey) {
  const url = `${versionApiUrl(parsed, version, 'ptFile')}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Roboflow ptFile response was not JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      json.error ||
        json.message ||
        `Roboflow ptFile failed (${res.status}). Manual weights download requires a trained version on a paid plan.`,
    );
  }
  const weightsUrl = json.weightsUrl || json.weights_url;
  if (!weightsUrl || typeof weightsUrl !== 'string') {
    throw new Error(
      'Roboflow returned no weightsUrl for this version. Train the model first, or use Upload .pt if your plan lacks weights download.',
    );
  }

  const dl = await fetch(weightsUrl);
  if (!dl.ok) {
    throw new Error(`weights.pt download failed (${dl.status})`);
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length < 10_000) {
    throw new Error('Downloaded file is too small to be weights.pt.');
  }
  return {
    buffer: buf,
    fileName: 'weights.pt',
    format: 'ptFile',
    exportLink: weightsUrl,
  };
}

function exportFormatsForTrainMeta(trainMeta) {
  const mt = String(trainMeta?.modelType || '').toLowerCase();
  if (mt.includes('yolo26') || mt.includes('yolo-26')) {
    return ['yolo26', 'yolov8', 'yolov5pytorch'];
  }
  if (mt.includes('yolov8') || mt.includes('yolo8')) {
    return ['yolov8', 'yolov5pytorch'];
  }
  return [...EXPORT_FORMATS_FALLBACK];
}

async function pullViaDatasetExport(parsed, version, apiKey, formats) {
  let lastErr = 'No export format succeeded';
  for (const format of formats) {
    try {
      const url = `${versionApiUrl(parsed, version, format)}?api_key=${encodeURIComponent(apiKey)}`;
      let json;
      for (let attempt = 0; attempt < 24; attempt++) {
        const res = await fetch(url);
        const text = await res.text();
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Roboflow export response was not JSON (${res.status})`);
        }
        if (!res.ok) {
          lastErr = json.error || json.message || `HTTP ${res.status}`;
          break;
        }
        const exportLink = json.export?.link;
        if (exportLink) {
          const dl = await fetch(exportLink);
          if (!dl.ok) {
            lastErr = `Download failed (${dl.status})`;
            break;
          }
          const buf = Buffer.from(await dl.arrayBuffer());
          const extracted = extractPtFromDownload(buf);
          if (!extracted) {
            lastErr = `Dataset export "${format}" has no .pt inside (use Pull from Roboflow / ptFile for weights.pt).`;
            break;
          }
          return {
            buffer: extracted.buffer,
            fileName: extracted.fileName,
            format,
            exportLink,
          };
        }
        if (json.progress != null && json.progress < 1) {
          await sleep(2500);
          continue;
        }
        lastErr = `Format "${format}" returned no export link.`;
        break;
      }
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  throw new Error(lastErr);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractPtFromDownload(buf) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    return extractPtFromZip(buf);
  }
  if (buf.length > 100_000) {
    return { buffer: buf, fileName: 'weights.pt' };
  }
  return null;
}

function extractPtFromZip(buf) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    return null;
  }
  const paths = Object.keys(files).filter(
    (k) => k.toLowerCase().endsWith('.pt') && !k.includes('__MACOSX') && !k.startsWith('.'),
  );
  if (!paths.length) return null;
  const score = (p) => {
    const lower = p.toLowerCase();
    if (lower.endsWith('weights.pt')) return 0;
    if (lower.endsWith('best.pt')) return 1;
    if (lower.includes('weights/')) return 2;
    return 10;
  };
  paths.sort((a, b) => score(a) - score(b));
  const pick = paths[0];
  const data = files[pick];
  if (!data?.length) return null;
  return {
    fileName: pick.split('/').pop() || 'weights.pt',
    buffer: Buffer.from(data),
  };
}
