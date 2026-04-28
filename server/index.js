import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the dist folder (built frontend)
app.use(express.static(path.join(__dirname, '../dist')));

// S3 Configuration - Single bucket with folder prefixes
const BUCKET_NAME = 'meter-reader-training-feedback';
const REGION = 'us-east-1';

// Supported work types (4-digit numeric codes)
const WORK_TYPES = ['1000', '2000', '3000', '4000', '5000'];

// Work type labels for display
const WORK_TYPE_LABELS = {
  '1000': 'Meter Reading',
  '2000': 'GO95 Electrical Pole Inspection',
  '3000': 'Riser Inspection',
  '4000': 'Leak Inspection',
  '5000': 'Intrusive Inspection',
};

// Legacy folder structure (for backward compatibility with existing data)
const LEGACY_FOLDERS = {
  field: {
    correct: 'f_correct/',
    incorrect: 'f_incorrect/',
  },
  simulator: {
    correct: 's_correct/',
    incorrect: 's_incorrect/',
  },
};

// Status to folder suffix mapping
const STATUS_FOLDER_MAP = {
  correct: 'correct',
  incorrect_new: 'incorrect',
  incorrect_analyzed: 'incorrect_analyzed',
  incorrect_labeled: 'incorrect_labeled',
  incorrect_training: 'incorrect_training',
  not_sure: 'not_sure',
  no_dials: 'no_dials',
};

// Return ALL folder prefixes to scan for a given status, source type, and work type.
// For work type '1000' we scan both the legacy root-level folders AND the 1000/ prefixed
// folders, because the iOS app switched to using the work-type prefix at some point.
function getFoldersForStatus(sourceType, status, workType = '1000') {
  const prefix = sourceType === 'field' ? 'f_' : 's_';
  const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';

  const folders = [];

  // Current format: {workType}/{prefix}{suffix}/
  folders.push(`${workType}/${prefix}${suffix}/`);

  // For work type 1000, also scan legacy root-level folders
  if (workType === '1000') {
    folders.push(`${prefix}${suffix}/`);
  }

  return folders;
}

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Helper to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Get signed URL for an image
async function getSignedImageUrl(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Parse session folder and extract reading data
async function parseSession(prefix, status, sourceType, workType = 'ANALOG_METER') {
  try {
    // Get metadata.json
    const metadataCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${prefix}metadata.json`,
    });
    
    const metadataResponse = await s3Client.send(metadataCommand);
    const metadataJson = await streamToString(metadataResponse.Body);
    const metadata = JSON.parse(metadataJson);
    
    // List all files in this session
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    });
    
    const listResponse = await s3Client.send(listCommand);
    const files = listResponse.Contents || [];
    
    // Get signed URLs for images
    const images = [];
    for (const file of files) {
      if (file.Key.endsWith('.jpg') || file.Key.endsWith('.jpeg') || file.Key.endsWith('.png')) {
        const fileName = file.Key.split('/').pop();
        const signedUrl = await getSignedImageUrl(file.Key);
        
        let label = 'Image';
        if (fileName === 'original.jpg') {
          label = 'Full Meter View';
        } else if (fileName.startsWith('dial_')) {
          const dialNum = fileName.match(/dial_(\d+)/)?.[1] || '?';
          label = `Dial ${dialNum}`;
        }
        
        images.push({
          id: file.Key,
          url: signedUrl,
          label,
          fileName,
          metadata: {
            capturedAt: metadata.timestamp,
            resolution: fileName === 'original.jpg' ? '4032x3024' : '224x224',
            fileSize: `${Math.round((file.Size || 0) / 1024)} KB`,
            dialIndex: fileName.startsWith('dial_') ? parseInt(fileName.match(/dial_(\d+)/)?.[1] || '0') - 1 : undefined,
          },
        });
      }
    }
    
    // Sort images: original first, then dials in order
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
      userName: metadata.user_name || undefined,
      imageSource: metadata.image_source || undefined,
      appVersion: metadata.app_version || undefined,
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

// Get readings from a specific folder prefix
async function getReadingsFromFolder(folderPrefix, status, sourceType, workType = '1000') {
  const readings = [];
  
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: folderPrefix,
      Delimiter: '/',
    });
    
    const response = await s3Client.send(command);
    const folders = response.CommonPrefixes || [];
    
    console.log(`   📂 ${folderPrefix} - ${folders.length} sessions`);
    
    for (const folder of folders) {
      const reading = await parseSession(folder.Prefix, status, sourceType, workType);
      if (reading) readings.push(reading);
    }
  } catch (error) {
    console.error(`Error listing folder ${folderPrefix}:`, error.message);
  }
  
  return readings;
}

// All status folders to scan (includes not_sure and no_dials from the iOS app)
const ALL_STATUSES = ['correct', 'incorrect_new', 'incorrect_analyzed', 'incorrect_labeled', 'incorrect_training', 'not_sure', 'no_dials'];

// Get all readings based on source and work type filter
async function getAllReadings(source = 'all', workType = '1000') {
  let readings = [];
  const seenSessions = new Set();
  
  console.log(`\n🔍 Fetching readings (source: ${source}, workType: ${workType})`);
  
  // Field data
  if (source === 'all' || source === 'field') {
    console.log('📦 Loading FIELD data...');
    
    for (const status of ALL_STATUSES) {
      const folders = getFoldersForStatus('field', status, workType);
      for (const folder of folders) {
        const statusReadings = await getReadingsFromFolder(folder, status, 'field', workType);
        for (const r of statusReadings) {
          if (!seenSessions.has(r.id)) {
            seenSessions.add(r.id);
            readings.push(r);
          }
        }
      }
    }
  }
  
  // Simulator data
  if (source === 'all' || source === 'simulator') {
    console.log('📦 Loading SIMULATOR data...');
    
    for (const status of ALL_STATUSES) {
      const folders = getFoldersForStatus('simulator', status, workType);
      for (const folder of folders) {
        const statusReadings = await getReadingsFromFolder(folder, status, 'simulator', workType);
        for (const r of statusReadings) {
          if (!seenSessions.has(r.id)) {
            seenSessions.add(r.id);
            readings.push(r);
          }
        }
      }
    }
  }
  
  // Sort by date, newest first
  readings.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));
  
  console.log(`✅ Total readings: ${readings.length}\n`);
  
  return readings;
}

// API Routes

// Get all work types
app.get('/api/work-types', (req, res) => {
  res.json(WORK_TYPES.map(code => ({
    code,
    name: WORK_TYPE_LABELS[code] || code,
  })));
});

// Get all readings
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

// Get dashboard counts
app.get('/api/counts', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    console.log(`\n📊 Calculating counts (source: ${source}, workType: ${workType})`);
    const readings = await getAllReadings(source, workType);
    
    const counts = {
      totalPictures: readings.reduce((sum, r) => sum + r.images.length, 0),
      correctCount: readings.filter(r => r.status === 'correct').length,
      incorrectNewCount: readings.filter(r => r.status === 'incorrect_new').length,
      incorrectAnalyzedCount: readings.filter(r => r.status === 'incorrect_analyzed').length,
      incorrectLabeledCount: readings.filter(r => r.status === 'incorrect_labeled').length,
      incorrectTrainingCount: readings.filter(r => r.status === 'incorrect_training').length,
      notSureCount: readings.filter(r => r.status === 'not_sure').length,
      noDialsCount: readings.filter(r => r.status === 'no_dials').length,
    };
    
    console.log('📊 Counts:', counts);
    res.json(counts);
  } catch (error) {
    console.error('Error calculating counts:', error);
    res.status(500).json({ error: 'Failed to calculate counts' });
  }
});

// Get single reading by ID
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

// Move a session folder from one status folder to another
async function moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus, workType = '1000') {
  const sourceFolders = getFoldersForStatus(sourceType, currentStatus, workType);
  const targetFolders = getFoldersForStatus(sourceType, targetStatus, workType);
  // Use the work-type-prefixed folder as the target (current format)
  const targetFolder = targetFolders[0];
  
  // Find the session folder - search across all possible source folders
  const possiblePrefixes = [];
  for (const sf of sourceFolders) {
    possiblePrefixes.push(`${sf}${sessionId}/`);
    possiblePrefixes.push(`${sf}${sourceType === 'field' ? 'f_' : 's_'}${sessionId}/`);
  }
  
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
    // List all objects in the source folder
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
    
    // Copy each object to the new location
    for (const obj of objects) {
      const fileName = obj.Key.replace(sourcePrefix, '');
      const newKey = `${targetFolder}${sourcePrefix.split('/').slice(-2, -1)[0]}/${fileName}`;
      
      // Copy object
      const copyCommand = new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${obj.Key}`,
        Key: newKey,
      });
      await s3Client.send(copyCommand);
      
      // Delete original
      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: obj.Key,
      });
      await s3Client.send(deleteCommand);
    }
    
    console.log(`  ✅ Moved ${objects.length} files`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error moving session ${sessionId}:`, error.message);
    return false;
  }
}

// Bulk move readings between status folders
app.post('/api/readings/bulk-move', async (req, res) => {
  try {
    const { readings } = req.body;
    
    if (!readings || !Array.isArray(readings)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    console.log(`\n🔄 Bulk moving ${readings.length} readings...`);
    
    let movedCount = 0;
    
    for (const reading of readings) {
      const { sessionId, sourceType, currentStatus, targetStatus } = reading;
      console.log(`  Moving ${sessionId}: ${currentStatus} -> ${targetStatus}`);
      
      const success = await moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus);
      if (success) movedCount++;
    }
    
    console.log(`✅ Moved ${movedCount}/${readings.length} readings\n`);
    
    res.json({ success: true, moved: movedCount, total: readings.length });
  } catch (error) {
    console.error('Error in bulk move:', error);
    res.status(500).json({ error: 'Failed to move readings' });
  }
});

// Download dataset as zip
// Streams images from S3 into a zip archive organized by session.
// Query params: source (all|field|simulator), workType, status (optional filter)
app.get('/api/download-dataset', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    const statusFilter = req.query.status; // optional: only download a specific status

    console.log(`\n📥 Dataset download requested (source: ${source}, workType: ${workType}, status: ${statusFilter || 'all'})`);

    const readings = await getAllReadings(source, workType);
    const filtered = statusFilter
      ? readings.filter(r => r.status === statusFilter)
      : readings;

    if (filtered.length === 0) {
      return res.status(404).json({ error: 'No readings found for the given filters' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `meter-dataset-${workType}-${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);

    let fileCount = 0;
    for (const reading of filtered) {
      const sessionDir = `${reading.status}/${reading.id}`;

      for (const image of reading.images) {
        try {
          const s3Key = image.id; // image.id is the full S3 key
          const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
          const response = await s3Client.send(command);
          archive.append(response.Body, { name: `${sessionDir}/${image.fileName}` });
          fileCount++;
        } catch (err) {
          console.warn(`  Skipping ${image.id}: ${err.message}`);
        }
      }

      // Also include metadata.json for each session
      try {
        const sessionPrefix = reading.images[0]?.id?.replace(/[^/]+$/, '') || '';
        if (sessionPrefix) {
          const metaCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${sessionPrefix}metadata.json` });
          const metaResponse = await s3Client.send(metaCommand);
          archive.append(metaResponse.Body, { name: `${sessionDir}/metadata.json` });
          fileCount++;
        }
      } catch {
        // metadata.json might not exist for some sessions
      }
    }

    await archive.finalize();
    console.log(`✅ Dataset download complete: ${fileCount} files, ${filtered.length} sessions\n`);
  } catch (error) {
    console.error('Error creating dataset download:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create dataset download' });
    }
  }
});

// Get dataset info (file count and size estimate) without downloading
app.get('/api/dataset-info', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || '1000';
    const statusFilter = req.query.status;

    const readings = await getAllReadings(source, workType);
    const filtered = statusFilter
      ? readings.filter(r => r.status === statusFilter)
      : readings;

    const statusBreakdown = {};
    for (const r of filtered) {
      statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
    }

    res.json({
      sessionCount: filtered.length,
      imageCount: filtered.reduce((sum, r) => sum + r.images.length, 0),
      statusBreakdown,
    });
  } catch (error) {
    console.error('Error getting dataset info:', error);
    res.status(500).json({ error: 'Failed to get dataset info' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bucket: BUCKET_NAME,
    workTypes: WORK_TYPES,
    region: REGION 
  });
});

// Serve React app for all non-API routes (client-side routing)
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
