import { createSessionIndexStore } from './dynamoStore.js';
import { metadataToSessionItem, sessionItemToReading } from './metadataMapping.js';
import { sessionPrefixFromMetadataKey } from './prefixInfer.js';

export { createSessionIndexStore } from './dynamoStore.js';
export * from './metadataMapping.js';
export * from './prefixInfer.js';
export * from './workTypes.js';
export * from './normalize.js';

const LIST_IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Resolve S3 key for list thumbnail. iOS uploads use original.jpg; portal manual
 * uploads keep the uploaded filename (e.g. PXL_….jpg).
 */
export async function resolvePrimaryListImageKey(reading, { s3Client, bucketName, keyCache } = {}) {
  if (!reading?.s3SessionPrefix) return null;
  const prefix = reading.s3SessionPrefix.endsWith('/') ? reading.s3SessionPrefix : `${reading.s3SessionPrefix}/`;

  if (reading.primaryImageKey) {
    const stored = String(reading.primaryImageKey);
    return stored.includes('/') ? stored : `${prefix}${stored}`;
  }

  if (keyCache?.has(prefix)) return keyCache.get(prefix);

  const defaultKey = `${prefix}original.jpg`;
  if (reading.status !== 'manually_uploaded') {
    keyCache?.set(prefix, defaultKey);
    return defaultKey;
  }

  if (!s3Client || !bucketName) {
    keyCache?.set(prefix, defaultKey);
    return defaultKey;
  }

  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const listed = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, MaxKeys: 50 }),
  );
  const imageKey = (listed.Contents || [])
    .map((o) => o.Key)
    .filter((key) => key && LIST_IMAGE_EXT.test(key.split('/').pop() || ''))
    .sort((a, b) => {
      const af = a.split('/').pop() || '';
      const bf = b.split('/').pop() || '';
      if (af === 'original.jpg') return -1;
      if (bf === 'original.jpg') return 1;
      return af.localeCompare(bf);
    })[0];

  const resolved = imageKey || defaultKey;
  keyCache?.set(prefix, resolved);
  return resolved;
}

/**
 * Attach presigned URL for list thumbnail (original.jpg or manual-upload file).
 * @param {object} reading
 * @param {(key: string) => Promise<string>} signKey
 * @param {{ s3Client?: object, bucketName?: string, keyCache?: Map<string, string> }} opts
 */
export async function attachPrimaryListImage(reading, signKey, opts = {}) {
  if (!reading?.s3SessionPrefix || typeof signKey !== 'function') return reading;
  const key = await resolvePrimaryListImageKey(reading, opts);
  if (!key) return reading;
  const fileName = key.split('/').pop() || 'original.jpg';
  try {
    const url = await signKey(key);
    return {
      ...reading,
      images: [
        {
          id: key,
          url,
          label: 'Full Meter View',
          fileName,
          metadata: { capturedAt: reading.dateOfReading },
        },
      ],
      imageCount: reading.imageCount ?? 1,
    };
  } catch {
    return reading;
  }
}

/** Batch attach primary list images with limited concurrency. */
export async function attachPrimaryListImages(readings, signKey, opts = {}) {
  if (!readings?.length) return readings;
  const concurrency = opts.concurrency ?? 20;
  const keyCache = opts.keyCache ?? new Map();
  const resolveOpts = { ...opts, keyCache };
  const out = [];
  for (let i = 0; i < readings.length; i += concurrency) {
    const batch = readings.slice(i, i + concurrency);
    const hydrated = await Promise.all(batch.map((r) => attachPrimaryListImage(r, signKey, resolveOpts)));
    out.push(...hydrated);
  }
  return out;
}

/**
 * Lambda handler entry: S3 ObjectCreated for metadata.json → Dynamo upsert.
 */
export async function handleS3MetadataSyncEvent(event, { store, s3BucketDefault }) {
  const results = [];
  for (const record of event.Records || []) {
    if (record.eventName?.startsWith('ObjectRemoved')) continue;
    const bucket = record.s3?.bucket?.name || s3BucketDefault;
    const key = decodeURIComponent(String(record.s3?.object?.key || '').replace(/\+/g, ' '));
    if (!key.endsWith('metadata.json')) continue;

    const prefix = sessionPrefixFromMetadataKey(key);
    if (!prefix) continue;

    const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await obj.Body.transformToString('utf-8');
    const metadata = JSON.parse(body);

    const item = await store.upsertFromMetadata(metadata, {
      s3Bucket: bucket,
      s3SessionPrefix: prefix,
      metadataEtag: obj.ETag,
      ingestSource: 's3_lambda',
    });
    results.push({ sessionId: item.session_id, prefix });
  }
  return { synced: results.length, results };
}

export function readingFromDynamoItem(item, images = []) {
  return sessionItemToReading(item, { images });
}

export function dynamoItemFromMetadata(metadata, ctx) {
  return metadataToSessionItem(metadata, ctx);
}
