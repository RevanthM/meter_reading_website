/**
 * S3 metadata.json → DynamoDB session index (Lambda).
 */
import { createSessionIndexStore, handleS3MetadataSyncEvent } from './sessionIndex/index.js';

const TABLE_NAME = process.env.SESSIONS_TABLE_NAME || process.env.AWS_DYNAMODB_SESSIONS_TABLE || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.AWS_S3_BUCKET || 'meter-reader-training-feedback';

const store = createSessionIndexStore({
  tableName: TABLE_NAME,
  region: REGION,
});

export async function handler(event) {
  if (!store.enabled) {
    throw new Error('SESSIONS_TABLE_NAME is not configured on Lambda');
  }
  return handleS3MetadataSyncEvent(event, { store, s3BucketDefault: BUCKET });
}
