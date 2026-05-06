import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import admin from 'firebase-admin';
import { registerRoboflowRoutes } from './roboflow.js';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
// Root `.env` first, then `src/.env` (later wins) — supports AWS creds in `src/.env` for local dev.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'src', '.env') });

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

app.use(express.static(path.join(__dirname, '../dist')));

const BUCKET_NAME = (process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback').trim();
const REGION = (process.env.AWS_REGION || 'us-east-1').trim();
/** If objects live under a parent folder (e.g. prod/ or mobile-uploads/), set AWS_S3_BASE_PREFIX=prod */
const S3_BASE_PREFIX = (process.env.AWS_S3_BASE_PREFIX || '').trim();

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

  const seen = new Set();
  return prefixes.filter((p) => {
    if (seen.has(p.folder)) return false;
    seen.add(p.folder);
    return true;
  });
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn('⚠️  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set — S3 routes will fail until .env is configured.');
}

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- In-memory cache ---
const cache = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute

function getCacheKey(source, workType) {
  return `${source}:${workType}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

function invalidateCache() {
  cache.clear();
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

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
        label = 'Full Meter View';
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
      if (a.fileName === 'original.jpg') return -1;
      if (b.fileName === 'original.jpg') return 1;
      return a.fileName.localeCompare(b.fileName);
    });
    
    return {
      id: metadata.session_id,
      /** Full S3 prefix for this session (trailing slash). Used for status moves. */
      s3SessionPrefix: prefix,
      dateOfReading: metadata.timestamp,
      location: sourceType === 'simulator' ? 'Simulator' : 'Field Capture',
      type: sourceType,
      status,
      workType: metadata.work_type || workType,
      meterValue: metadata.ml_prediction,
      expectedValue: metadata.user_correction || undefined,
      rawPrediction: metadata.ml_raw_prediction,
      isCorrect: metadata.is_correct,
      confidence: metadata.confidence,
      processingTimeMs: metadata.processing_time_ms,
      dialCount: metadata.dial_count,
      dialDetails: metadata.dial_details,
      conditionCode: metadata.condition_code,
      userName: metadata.user_name || metadata.user_email || '',
      imageSource: metadata.image_source || '',
      uploadMode: metadata.upload_mode || '',
      feedbackType: metadata.feedback_type || '',
      /** iOS `AppConfig.appVersion` — use to compare on-device model generations. */
      appVersion: metadata.app_version != null ? String(metadata.app_version) : '',
      comments: '',
      images,
      createdAt: metadata.timestamp,
      updatedAt: metadata.timestamp,
    };
  } catch (error) {
    console.error(`Error parsing session ${prefix}:`, error.message);
    return null;
  }
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

async function getAllReadings(source = 'all', workType = '1000') {
  const cacheKey = getCacheKey(source, workType);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`⚡ Cache hit for ${cacheKey} (${cached.length} readings)`);
    return cached;
  }

  console.log(`\n🔍 Fetching readings (source: ${source}, workType: ${workType})`);
  
  const allPrefixes = getAllFolderPrefixes(source, workType);
  
  const folderJobs = allPrefixes.map(({ folder, status, sourceType }) =>
    getReadingsFromFolder(folder, status, sourceType, workType)
  );

  const results = await Promise.all(folderJobs);
  const readings = results.flat();
  
  // Deduplicate by session ID (same session may appear in root and 1000/ prefix)
  const seen = new Set();
  const unique = readings.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  
  unique.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));
  
  console.log(`✅ Total readings: ${unique.length}\n`);
  
  setCache(cacheKey, unique);
  return unique;
}

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

// Lightweight counts: just count session folders without parsing metadata
async function getCountsFromFolders(source = 'all', workType = '1000') {
  const cacheKey = `counts:${source}:${workType}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`⚡ Cache hit for counts ${source}:${workType}`);
    return cached;
  }

  console.log(`\n📊 Counting sessions (source: ${source}, workType: ${workType})`);

  const allPrefixes = getAllFolderPrefixes(source, workType);

  const countJobs = allPrefixes.map(({ folder }) =>
    countSessionSubfoldersUnderPrefix(folder).catch((err) => {
      console.error(`📊 S3 count failed for prefix "${folder}":`, err.name || err.message);
      return 0;
    })
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
  };

  const statusToKey = {
    correct: 'correctCount',
    incorrect_new: 'incorrectNewCount',
    incorrect_analyzed: 'incorrectAnalyzedCount',
    incorrect_labeled: 'incorrectLabeledCount',
    incorrect_training: 'incorrectTrainingCount',
    no_dials: 'noDialsCount',
    not_sure: 'notSureCount',
  };

  results.forEach((count, i) => {
    const status = allPrefixes[i].status;
    if (statusToKey[status]) {
      counts[statusToKey[status]] += count;
    }
    counts.totalPictures += count;
  });

  console.log('📊 Counts:', counts);
  setCache(cacheKey, counts);
  return counts;
}

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
    const readings = await getAllReadings(source, workType);
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
    const counts = await getCountsFromFolders(source, workType);
    res.json(counts);
  } catch (error) {
    console.error('Error calculating counts:', error);
    res.status(500).json({ error: 'Failed to calculate counts' });
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

    const reading = await findReadingAcrossWorkTypes(id, workTypeHint);

    if (!reading) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    res.json(reading);
  } catch (error) {
    console.error('Error fetching reading:', error);
    res.status(500).json({ error: 'Failed to fetch reading' });
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

    invalidateCache();
    
    await loadActivityLog();
    for (const reading of readings) {
      activityLog.unshift({
        id: `${Date.now()}-${reading.sessionId}`,
        timestamp: new Date().toISOString(),
        userEmail: req.headers['x-user-email'] || 'unknown',
        action: 'status_change',
        sessionId: reading.sessionId,
        fromStatus: reading.currentStatus,
        toStatus: reading.targetStatus,
        sourceType: reading.sourceType,
      });
    }
    await saveActivityLog();
    
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
    roboflow: Boolean(process.env.ROBOFLOW_API_KEY),
  });
});

registerRoboflowRoutes(app, {
  WORK_TYPES,
  getAllReadings,
  s3Client,
  BUCKET_NAME,
});

const EXPORT_INCORRECT_MAX_SESSIONS = Math.max(
  1,
  Math.min(10_000, parseInt(process.env.EXPORT_INCORRECT_MAX_SESSIONS || '3000', 10) || 3000),
);

/** Resolve a reading by session id across work types (same logic as GET /api/readings/:id). */
async function findReadingAcrossWorkTypes(id, workTypeHint) {
  let reading = null;
  if (workTypeHint && WORK_TYPES.includes(workTypeHint)) {
    const list = await getAllReadings('all', workTypeHint);
    reading = list.find((r) => r.id === id) || null;
  }
  if (!reading) {
    for (const wt of WORK_TYPES) {
      if (wt === workTypeHint) continue;
      const list = await getAllReadings('all', wt);
      reading = list.find((r) => r.id === id) || null;
      if (reading) break;
    }
  }
  return reading;
}

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

/** One folder in the zip per session: images + metadata.json (same layout as bulk incorrect export). */
async function appendReadingSessionToArchive(archive, r) {
  const safeId = String(r.id).replace(/[^a-zA-Z0-9._-]/g, '_');
  const addedKeys = new Set();
  const usedZipNames = new Set();

  const uniqueZipPath = (baseName) => {
    let name = `${safeId}/${baseName}`;
    if (!usedZipNames.has(name)) {
      usedZipNames.add(name);
      return name;
    }
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    let n = 1;
    while (usedZipNames.has(`${safeId}/${stem}_${n}${ext}`)) n += 1;
    name = `${safeId}/${stem}_${n}${ext}`;
    usedZipNames.add(name);
    return name;
  };

  for (const img of r.images || []) {
    const key = img.id;
    const fname = img.fileName || (key && key.split('/').pop()) || 'image.jpg';
    if (!key || addedKeys.has(key)) continue;
    addedKeys.add(key);
    try {
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
      if (obj.Body) {
        const buf = await streamToBuffer(obj.Body);
        if (buf && buf.length) {
          archive.append(buf, { name: uniqueZipPath(fname) });
        }
      }
    } catch (e) {
      console.warn(`export zip skip image ${key}:`, e.message);
    }
  }

  let metaKey = r.s3SessionPrefix ? `${r.s3SessionPrefix}metadata.json` : null;
  if (!metaKey && r.images?.[0]?.id) {
    const k = r.images[0].id;
    const ix = k.lastIndexOf('/');
    if (ix > 0) metaKey = `${k.slice(0, ix + 1)}metadata.json`;
  }
  if (metaKey && !addedKeys.has(metaKey)) {
    try {
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: metaKey }));
      if (obj.Body) {
        const buf = await streamToBuffer(obj.Body);
        if (buf && buf.length) {
          archive.append(buf, { name: uniqueZipPath('metadata.json') });
        }
      }
    } catch (e) {
      console.warn(`export zip skip metadata ${metaKey}:`, e.message);
    }
  }
}

/**
 * ZIP a single session (images + metadata) for labeling / training tools.
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

    const safeFile = String(reading.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `session-${safeFile}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', '1');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    await appendReadingSessionToArchive(archive, reading);
    await archive.finalize();
  } catch (e) {
    console.error('session-retrain-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

/**
 * ZIP sessions matching a readings list view: workType, source, list status (and optional single-day filter).
 * One folder per session: images + metadata.json (same layout as incorrect bulk export).
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
    const filename = `sessions-${safeSlug}${datePart}${appPart}-${workType}-${source}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', String(truncated.length));
    res.setHeader('X-Export-Total-Found', String(sessions.length));
    if (truncatedFlag) res.setHeader('X-Export-Truncated', 'true');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    for (const r of truncated) {
      await appendReadingSessionToArchive(archive, r);
    }

    await archive.finalize();
  } catch (e) {
    console.error('list-retrain-zip:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Export failed' });
    }
  }
});

/**
 * ZIP all sessions in any incorrect_* queue (same slice as dashboard: workType + source).
 * Kept for backward compatibility; same output as list-retrain-zip?listStatus=incorrect-queues.
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

    const filename = `incorrect-retrain-${workType}-${source}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Session-Count', String(truncated.length));
    res.setHeader('X-Export-Total-Found', String(sessions.length));
    if (truncatedFlag) res.setHeader('X-Export-Truncated', 'true');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('archiver warning:', err.message));
    archive.on('error', (err) => {
      console.error('archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    for (const r of truncated) {
      await appendReadingSessionToArchive(archive, r);
    }

    await archive.finalize();
  } catch (e) {
    console.error('incorrect-retrain-zip:', e);
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

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`🌎 Region: ${REGION}`);
  console.log(`📂 S3 base prefix: ${S3_BASE_PREFIX || '(none — keys at bucket root)'}`);
  console.log(`📋 Work Types: ${WORK_TYPES.join(', ')}`);
  console.log(`🔎 S3 layout debug: GET http://localhost:${PORT}/api/s3-discover`);
  await loadActivityLog();
  console.log('');
});
