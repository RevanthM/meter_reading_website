import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../dist')));

const BUCKET_NAME = 'meter-reader-training-feedback';
const REGION = 'us-east-1';

const WORK_TYPES = ['1000', '2000', '3000', '4000', '5000'];

const WORK_TYPE_LABELS = {
  '1000': 'Meter Reading',
  '2000': 'GO95 Electrical Pole Inspection',
  '3000': 'Riser Inspection',
  '4000': 'Leak Inspection',
  '5000': 'Intrusive Inspection',
};

const STATUS_FOLDER_MAP = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
};

function getFolderForStatus(sourceType, status, workType = null) {
  const prefix = sourceType === 'field' ? 'f_' : 's_';
  const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
  
  if (workType && workType !== '1000') {
    return `${workType}/${prefix}${suffix}/`;
  }
  return `${prefix}${suffix}/`;
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

const ALL_STATUSES = ['correct', 'incorrect_new', 'incorrect_analyzed', 'incorrect_labeled', 'incorrect_training'];

async function getAllReadings(source = 'all', workType = '1000') {
  const cacheKey = getCacheKey(source, workType);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`⚡ Cache hit for ${cacheKey} (${cached.length} readings)`);
    return cached;
  }

  console.log(`\n🔍 Fetching readings (source: ${source}, workType: ${workType})`);
  
  const folderJobs = [];

  if (source === 'all' || source === 'field') {
    for (const status of ALL_STATUSES) {
      const folder = getFolderForStatus('field', status, workType);
      folderJobs.push(getReadingsFromFolder(folder, status, 'field', workType));
    }
  }
  
  if (source === 'all' || source === 'simulator') {
    for (const status of ALL_STATUSES) {
      const folder = getFolderForStatus('simulator', status, workType);
      folderJobs.push(getReadingsFromFolder(folder, status, 'simulator', workType));
    }
  }

  const results = await Promise.all(folderJobs);
  const readings = results.flat();
  
  readings.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));
  
  console.log(`✅ Total readings: ${readings.length}\n`);
  
  setCache(cacheKey, readings);
  return readings;
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

  const countJobs = [];
  const statusLabels = [];

  const sources = source === 'all' ? ['field', 'simulator'] : [source];

  for (const src of sources) {
    for (const status of ALL_STATUSES) {
      const folder = getFolderForStatus(src, status, workType);
      statusLabels.push(status);
      countJobs.push(
        s3Client.send(new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: folder,
          Delimiter: '/',
        })).then(r => (r.CommonPrefixes || []).length)
          .catch(() => 0)
      );
    }
  }

  const results = await Promise.all(countJobs);

  const counts = {
    totalPictures: 0,
    correctCount: 0,
    incorrectNewCount: 0,
    incorrectAnalyzedCount: 0,
    incorrectLabeledCount: 0,
    incorrectTrainingCount: 0,
  };

  const statusToKey = {
    correct: 'correctCount',
    incorrect_new: 'incorrectNewCount',
    incorrect_analyzed: 'incorrectAnalyzedCount',
    incorrect_labeled: 'incorrectLabeledCount',
    incorrect_training: 'incorrectTrainingCount',
  };

  results.forEach((count, i) => {
    const status = statusLabels[i];
    counts[statusToKey[status]] += count;
    counts.totalPictures += count;
  });

  console.log('📊 Counts:', counts);
  setCache(cacheKey, counts);
  return counts;
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

app.get('/api/readings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`\n🔍 Fetching reading: ${id}`);
    
    const readings = await getAllReadings('all');
    const reading = readings.find(r => r.id === id);
    
    if (!reading) {
      return res.status(404).json({ error: 'Reading not found' });
    }
    
    res.json(reading);
  } catch (error) {
    console.error('Error fetching reading:', error);
    res.status(500).json({ error: 'Failed to fetch reading' });
  }
});

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

const activityLog = [];

app.post('/api/readings/bulk-move', async (req, res) => {
  try {
    const { readings } = req.body;
    
    if (!readings || !Array.isArray(readings)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    console.log(`\n🔄 Bulk moving ${readings.length} readings...`);
    
    const moveResults = await Promise.all(
      readings.map(({ sessionId, sourceType, currentStatus, targetStatus }) => {
        console.log(`  Moving ${sessionId}: ${currentStatus} -> ${targetStatus}`);
        return moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus);
      })
    );

    const movedCount = moveResults.filter(Boolean).length;
    
    console.log(`✅ Moved ${movedCount}/${readings.length} readings\n`);

    invalidateCache();
    
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
    
    res.json({ success: true, moved: movedCount, total: readings.length });
  } catch (error) {
    console.error('Error in bulk move:', error);
    res.status(500).json({ error: 'Failed to move readings' });
  }
});

app.get('/api/activity-log', (req, res) => {
  res.json(activityLog);
});

app.get('/api/uploads', async (req, res) => {
  try {
    const email = req.query.email;
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    
    const readings = await getAllReadings(source, workType);
    
    const uploads = readings.map(r => ({
      id: r.id,
      sessionId: r.id,
      timestamp: r.dateOfReading,
      userEmail: email || '',
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

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bucket: BUCKET_NAME,
    workTypes: WORK_TYPES,
    region: REGION 
  });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`🌎 Region: ${REGION}`);
  console.log(`📋 Work Types: ${WORK_TYPES.join(', ')}`);
  console.log('');
});
