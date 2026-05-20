/**
 * Portal meter inference — local Python Combined P3 (detector + keypoint + Stage D).
 * Uses a persistent worker process so models are loaded once per server lifetime.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SCRIPTS_DIR = path.resolve(
  __dirname,
  '../../iOS App/AnalogMeterReader_IOS/training/scripts',
);

const WORKER_START_TIMEOUT_MS = Number(process.env.METER_INFERENCE_WORKER_START_MS) || 180_000;
const WORKER_REQUEST_TIMEOUT_MS = Number(process.env.METER_INFERENCE_WORKER_REQUEST_MS) || 120_000;

/** @type {{ process: import('node:child_process').ChildProcess, ready: boolean, pipeline: string | null, stdoutBuffer: string, pending: Map<string, { resolve: Function, reject: Function }>, nextResponseId: string | null, readyWaiter: { resolve: Function, reject: Function } | null, startPromise: Promise<unknown> | null } | null} */
let workerState = null;

function envPath(key, fallback) {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

function firstExistingPath(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export function getMeterInferenceConfig() {
  const scriptsDir = envPath('METER_INFERENCE_SCRIPTS_DIR', DEFAULT_SCRIPTS_DIR);
  const trainingRoot = path.join(scriptsDir, '..');
  const venvPython = path.join(trainingRoot, '.venv', 'bin', 'python');
  const pythonBin = envPath(
    'METER_INFERENCE_PYTHON',
    fs.existsSync(venvPython) ? venvPython : 'python3',
  );
  const cliScript = path.join(scriptsDir, 'inference_portal_json.py');
  const workerScript = path.join(scriptsDir, 'inference_portal_worker.py');
  const detectionModel = envPath(
    'METER_DETECTION_MODEL',
    path.join(trainingRoot, 'models', 'detection', 'best.pt'),
  );
  const keypointModel = envPath(
    'METER_KEYPOINT_MODEL',
    firstExistingPath([
      path.join(trainingRoot, 'exports', 'combined_p3_iter3', 'weights.pt'),
      path.join(trainingRoot, 'models', 'keypoint', 'weights.pt'),
    ]),
  );
  const useWorker = process.env.METER_INFERENCE_ONESHOT !== '1';
  return {
    scriptsDir,
    pythonBin,
    cliScript,
    workerScript,
    detectionModel: path.resolve(detectionModel),
    keypointModel: path.resolve(keypointModel),
    enabled: process.env.METER_INFERENCE_ENABLED !== '0',
    useWorker: useWorker && fs.existsSync(workerScript),
  };
}

export function getMeterInferenceStatus() {
  const cfg = getMeterInferenceConfig();
  const checks = {
    enabled: cfg.enabled,
    pythonBin: cfg.pythonBin,
    cliScript: fs.existsSync(cfg.cliScript),
    workerScript: fs.existsSync(cfg.workerScript),
    detectionModel: fs.existsSync(cfg.detectionModel),
    keypointModel: fs.existsSync(cfg.keypointModel),
    scriptsDir: fs.existsSync(cfg.scriptsDir),
    workerMode: cfg.useWorker,
    workerReady: Boolean(workerState?.ready),
  };
  checks.ready =
    cfg.enabled && checks.cliScript && checks.detectionModel && checks.keypointModel;
  return { ...cfg, checks };
}

/** Avoid Conda / PYTHONPATH breaking the training venv when Node spawns Python. */
function buildPythonSpawnEnv(cfg) {
  const venvBin = path.dirname(cfg.pythonBin);
  const venvRoot = path.dirname(venvBin);
  const spawnEnv = { ...process.env };
  delete spawnEnv.PYTHONPATH;
  delete spawnEnv.PYTHONHOME;
  delete spawnEnv.CONDA_PREFIX;
  delete spawnEnv.CONDA_DEFAULT_ENV;
  delete spawnEnv.CONDA_PYTHON_EXE;
  spawnEnv.PATH = `${venvBin}:${spawnEnv.PATH || '/usr/bin:/bin'}`;
  spawnEnv.VIRTUAL_ENV = venvRoot;
  spawnEnv.PYTHONUNBUFFERED = '1';
  return spawnEnv;
}

/** Cursor/Node is often x86_64 under Rosetta; training .venv is arm64 — run Python natively. */
function spawnPython(cfg, args, options) {
  const useArm64 =
    process.platform === 'darwin' && process.env.METER_INFERENCE_ARCH_ARM64 !== '0';
  if (useArm64) {
    return spawn('arch', ['-arm64', cfg.pythonBin, ...args], options);
  }
  return spawn(cfg.pythonBin, args, options);
}

function parseJsonLineFromStdout(stdout, stderr, exitCode) {
  const lines = stdout
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((l) => l.startsWith('{') && l.endsWith('}'));
  if (jsonLine) {
    try {
      return JSON.parse(jsonLine);
    } catch {
      /* fall through */
    }
  }
  const errSnippet = (stderr || stdout || '').trim().slice(0, 500);
  if (exitCode !== 0) {
    throw new Error(errSnippet || `Python inference exited ${exitCode}`);
  }
  throw new Error(
    errSnippet
      ? `Inference produced no JSON output: ${errSnippet}`
      : 'Inference produced no JSON output',
  );
}

function killWorker() {
  if (!workerState) return;
  const { process: proc, pending } = workerState;
  for (const [, handlers] of pending) {
    handlers.reject(new Error('Inference worker restarted'));
  }
  workerState = null;
  try {
    proc.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

function handleWorkerStdoutLine(line) {
  if (!workerState) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  if (parsed.ready === true && !workerState.ready) {
    workerState.ready = true;
    workerState.pipeline = parsed.pipeline;
    if (workerState.readyWaiter) {
      workerState.readyWaiter.resolve(parsed);
      workerState.readyWaiter = null;
    }
    return;
  }

  const id = workerState.nextResponseId;
  if (id == null) return;
  workerState.nextResponseId = null;
  const handlers = workerState.pending.get(id);
  if (!handlers) return;
  workerState.pending.delete(id);
  if (parsed.ok === false && parsed.error) {
    handlers.reject(new Error(parsed.error));
  } else {
    handlers.resolve(parsed);
  }
}

function flushWorkerStdoutBuffer() {
  if (!workerState?.stdoutBuffer) return;
  const parts = workerState.stdoutBuffer.split('\n');
  workerState.stdoutBuffer = parts.pop() || '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (trimmed) handleWorkerStdoutLine(trimmed);
  }
}

function startWorker(cfg) {
  killWorker();

  const args = [
    cfg.workerScript,
    '--detection-model',
    cfg.detectionModel,
    '--keypoint-model',
    cfg.keypointModel,
  ];

  const proc = spawnPython(cfg, args, {
    cwd: cfg.scriptsDir,
    env: buildPythonSpawnEnv(cfg),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const state = {
    process: proc,
    ready: false,
    pipeline: null,
    stdoutBuffer: '',
    pending: new Map(),
    nextResponseId: null,
    readyWaiter: null,
    startPromise: null,
  };
  workerState = state;

  proc.stdout.on('data', (chunk) => {
    state.stdoutBuffer += chunk.toString();
    flushWorkerStdoutBuffer();
  });

  proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.error('[meter-inference]', msg);
  });

  proc.on('error', (err) => {
    if (state.readyWaiter) {
      state.readyWaiter.reject(err);
      state.readyWaiter = null;
    }
    for (const [, handlers] of state.pending) {
      handlers.reject(err);
    }
    state.pending.clear();
    if (workerState === state) workerState = null;
  });

  proc.on('close', (code) => {
    const err = new Error(`Inference worker exited (${code ?? 'signal'})`);
    if (state.readyWaiter) {
      state.readyWaiter.reject(err);
      state.readyWaiter = null;
    }
    for (const [, handlers] of state.pending) {
      handlers.reject(err);
    }
    state.pending.clear();
    if (workerState === state) workerState = null;
  });

  state.startPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!state.ready) {
        killWorker();
        reject(
          new Error(
            `Inference worker did not become ready within ${WORKER_START_TIMEOUT_MS / 1000}s (model load)`,
          ),
        );
      }
    }, WORKER_START_TIMEOUT_MS);
    state.readyWaiter = {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };
  });

  return state.startPromise;
}

async function ensureWorkerReady(cfg) {
  if (workerState?.ready) return workerState;
  if (workerState?.startPromise) {
    await workerState.startPromise;
    return workerState;
  }
  await startWorker(cfg);
  return workerState;
}

async function runInferenceViaWorker(cfg, imagePath, dialOutputDir) {
  await ensureWorkerReady(cfg);
  const state = workerState;
  if (!state?.ready || !state.process?.stdin?.writable) {
    throw new Error('Inference worker is not ready');
  }

  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(requestId);
      state.nextResponseId = null;
      killWorker();
      reject(new Error(`Inference timed out after ${WORKER_REQUEST_TIMEOUT_MS / 1000}s`));
    }, WORKER_REQUEST_TIMEOUT_MS);

    state.pending.set(requestId, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    state.nextResponseId = requestId;

    const payload =
      JSON.stringify({
        cmd: 'infer',
        image_path: imagePath,
        dial_output_dir: dialOutputDir || undefined,
      }) + '\n';
    state.process.stdin.write(payload, (err) => {
      if (err) {
        clearTimeout(timer);
        state.pending.delete(requestId);
        state.nextResponseId = null;
        reject(err);
      }
    });
  });
}

async function hydrateDialBuffersFromPaths(parsed) {
  const paths = parsed?.dial_jpeg_paths;
  if (!Array.isArray(paths) || paths.length === 0) return parsed;
  const dialJpegBuffers = [];
  for (let i = 0; i < paths.length; i += 1) {
    const p = String(paths[i] || '').trim();
    if (!p) continue;
    try {
      const buffer = await fs.promises.readFile(p);
      if (buffer.length) dialJpegBuffers.push({ dial: i + 1, buffer });
    } catch {
      /* skip */
    }
  }
  return { ...parsed, dialJpegBuffers };
}

async function runInferenceOneshot(cfg, tmpImage, dialOutputDir) {
  const args = [
    cfg.cliScript,
    '--image',
    tmpImage,
    '--detection-model',
    cfg.detectionModel,
    '--keypoint-model',
    cfg.keypointModel,
  ];
  if (dialOutputDir) {
    args.push('--dial-output-dir', dialOutputDir);
  }

  const { stdout, stderr, code } = await new Promise((resolve, reject) => {
    const child = spawnPython(cfg, args, {
      cwd: cfg.scriptsDir,
      env: buildPythonSpawnEnv(cfg),
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout: out, stderr: err, code: exitCode }));
  });

  const parsed = parseJsonLineFromStdout(stdout, stderr, code);
  if (!parsed.ok) {
    throw new Error(parsed.error || 'Inference failed');
  }
  return parsed;
}

/**
 * Preload models in a background worker (call on server start).
 */
export function warmMeterInferenceWorker() {
  const cfg = getMeterInferenceConfig();
  const status = getMeterInferenceStatus();
  if (!status.checks.ready || !cfg.useWorker) return Promise.resolve(false);
  return ensureWorkerReady(cfg)
    .then(() => true)
    .catch((e) => {
      console.warn('Meter inference worker warmup failed:', e.message);
      return false;
    });
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} [originalName]
 */
export async function runMeterInferenceOnBuffer(imageBuffer, originalName = 'upload.jpg') {
  const cfg = getMeterInferenceConfig();
  const status = getMeterInferenceStatus();
  if (!status.checks.ready) {
    const missing = [];
    if (!status.checks.cliScript) missing.push('inference_portal_json.py');
    if (!status.checks.detectionModel) missing.push('detection model (.pt)');
    if (!status.checks.keypointModel) missing.push('keypoint model (.pt)');
    throw new Error(
      `Meter inference is not configured (${missing.join(', ')}). Set METER_DETECTION_MODEL / METER_KEYPOINT_MODEL in .env.`,
    );
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'portal-infer-'));
  const dialDir = path.join(tmpDir, 'dials');
  await fs.promises.mkdir(dialDir, { recursive: true });
  const ext = path.extname(originalName) || '.jpg';
  const tmpImage = path.join(tmpDir, `image${ext}`);
  await fs.promises.writeFile(tmpImage, imageBuffer);

  try {
    let parsed;
    if (cfg.useWorker) {
      try {
        parsed = await runInferenceViaWorker(cfg, tmpImage, dialDir);
      } catch (workerErr) {
        console.warn('Worker inference failed, falling back to one-shot:', workerErr.message);
        parsed = await runInferenceOneshot(cfg, tmpImage, dialDir);
      }
    } else {
      parsed = await runInferenceOneshot(cfg, tmpImage, dialDir);
    }

    if (!parsed.ok) {
      throw new Error(parsed.error || 'Inference failed');
    }
    return await hydrateDialBuffersFromPaths(parsed);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildPortalInferenceSessionId(workType, sourceType) {
  const wt = String(workType || '1000').trim() || '1000';
  const mode = sourceType === 'field' ? 'f' : 's';
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .slice(0, 15);
  return `${wt}_p_${ts}_${randomUUID().slice(0, 8)}`;
}

export function portalInferenceFolderPrefix(workType, sourceType, sessionId) {
  const wt = String(workType || '1000').trim() || '1000';
  const mode = sourceType === 'field' ? 'f' : 's';
  const id = String(sessionId).trim();
  return `${wt}/${mode}_skipped_review/${id}/`;
}
