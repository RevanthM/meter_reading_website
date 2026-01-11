import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const BUCKET_NAME = 'meter-reader-training-feedback';
const REGION = 'us-east-1';

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function listTopLevelFolders() {
  console.log(`\n📦 Checking bucket: ${BUCKET_NAME}\n`);
  
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Delimiter: '/',
    });
    
    const response = await s3Client.send(command);
    
    console.log('📁 Top-level folders found:');
    if (response.CommonPrefixes && response.CommonPrefixes.length > 0) {
      for (const prefix of response.CommonPrefixes) {
        console.log(`   - ${prefix.Prefix}`);
        
        // List subfolders for each top-level folder
        const subCommand = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix.Prefix,
          Delimiter: '/',
          MaxKeys: 5,
        });
        
        const subResponse = await s3Client.send(subCommand);
        if (subResponse.CommonPrefixes && subResponse.CommonPrefixes.length > 0) {
          console.log(`     Sample subfolders:`);
          for (const subPrefix of subResponse.CommonPrefixes.slice(0, 3)) {
            console.log(`       - ${subPrefix.Prefix}`);
          }
          if (subResponse.CommonPrefixes.length > 3) {
            console.log(`       ... and ${subResponse.CommonPrefixes.length - 3} more`);
          }
        }
      }
    } else {
      console.log('   (no folders found)');
    }
    
    // Also list any top-level files
    if (response.Contents && response.Contents.length > 0) {
      console.log('\n📄 Top-level files:');
      for (const file of response.Contents.slice(0, 5)) {
        console.log(`   - ${file.Key}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listTopLevelFolders();
