import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// S3 Configuration - Single bucket with folder prefixes
const BUCKET_NAME = 'meter-reader-training-feedback';
const REGION = 'us-west-2';

// Supported work types
const WORK_TYPES = ['ANALOG_METER', 'GO95', 'RISR', 'LEAK', 'INTR'];

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
};

// Get folder prefix for a status, source type, and work type
function getFolderForStatus(sourceType, status, workType = null) {
  const prefix = sourceType === 'field' ? 'f_' : 's_';
  const suffix = STATUS_FOLDER_MAP[status] || 'incorrect';
  
  if (workType && workType !== 'ANALOG_METER') {
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
async function getReadingsFromFolder(folderPrefix, status, sourceType, workType = 'ANALOG_METER') {
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

// All status folders to scan
const ALL_STATUSES = ['correct', 'incorrect_new', 'incorrect_analyzed', 'incorrect_labeled', 'incorrect_training'];

// Get all readings based on source and work type filter
async function getAllReadings(source = 'all', workType = 'ANALOG_METER') {
  let readings = [];
  
  console.log(`\n🔍 Fetching readings (source: ${source}, workType: ${workType})`);
  
  // Field data
  if (source === 'all' || source === 'field') {
    console.log('📦 Loading FIELD data...');
    
    for (const status of ALL_STATUSES) {
      const folder = getFolderForStatus('field', status, workType);
      const statusReadings = await getReadingsFromFolder(folder, status, 'field', workType);
      readings = readings.concat(statusReadings);
    }
  }
  
  // Simulator data
  if (source === 'all' || source === 'simulator') {
    console.log('📦 Loading SIMULATOR data...');
    
    for (const status of ALL_STATUSES) {
      const folder = getFolderForStatus('simulator', status, workType);
      const statusReadings = await getReadingsFromFolder(folder, status, 'simulator', workType);
      readings = readings.concat(statusReadings);
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
    name: {
      'ANALOG_METER': 'Analog Meter Reading',
      'GO95': 'GO95 Electrical Pole Inspection',
      'RISR': 'Riser Inspection',
      'LEAK': 'Leak Inspection',
      'INTR': 'Intrusive Inspection',
    }[code] || code,
  })));
});

// Get all readings
app.get('/api/readings', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const workType = req.query.workType || 'ANALOG_METER';
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
    const workType = req.query.workType || 'ANALOG_METER';
    console.log(`\n📊 Calculating counts (source: ${source}, workType: ${workType})`);
    const readings = await getAllReadings(source, workType);
    
    const counts = {
      totalPictures: readings.reduce((sum, r) => sum + r.images.length, 0),
      correctCount: readings.filter(r => r.status === 'correct').length,
      incorrectNewCount: readings.filter(r => r.status === 'incorrect_new').length,
      incorrectAnalyzedCount: readings.filter(r => r.status === 'incorrect_analyzed').length,
      incorrectLabeledCount: readings.filter(r => r.status === 'incorrect_labeled').length,
      incorrectTrainingCount: readings.filter(r => r.status === 'incorrect_training').length,
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
async function moveSessionFolder(sessionId, sourceType, currentStatus, targetStatus) {
  const sourceFolder = getFolderForStatus(sourceType, currentStatus);
  const targetFolder = getFolderForStatus(sourceType, targetStatus);
  
  // Find the session folder - it could have a prefix like f_ or just the session ID
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    bucket: BUCKET_NAME,
    workTypes: WORK_TYPES,
    region: REGION 
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`🌎 Region: ${REGION}`);
  console.log(`📋 Work Types: ${WORK_TYPES.join(', ')}`);
  console.log('');
});
