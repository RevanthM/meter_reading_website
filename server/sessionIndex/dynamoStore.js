import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ALL_STATUSES } from './workTypes.js';
import {
  buildGsi1Pk,
  buildGsi1Sk,
  dedupeReadings,
  metadataToSessionItem,
  sessionItemToReading,
} from './metadataMapping.js';
import { inferStatusAndSourceFromSessionPrefix, normalizeS3SessionPrefix } from './prefixInfer.js';

/** List/analytics queries — omit dial_details (large JSON blobs). */
const LIST_READING_PROJECTION = [
  'session_id',
  's3_session_prefix',
  's3_bucket',
  'captured_at',
  'folder_status',
  'source_type',
  'portal_work_type',
  'work_type_code',
  'work_type_name',
  'upload_mode',
  'image_source',
  'capture_trigger',
  'user_name',
  'user_email',
  'feedback_type',
  'ml_prediction',
  'ml_raw_prediction',
  'user_correction',
  'confidence',
  'processing_time_ms',
  'dial_count',
  'app_version',
  'condition_code',
  'is_correct',
  'is_manually_reviewed',
  'portal_review_notes',
  'portal_metadata_updated_at',
  'portal_metadata_updated_by',
  'reviewer_dataset_destination',
  'image_difficulty',
  'on_tick_dial_count',
  'reads_corrected_count',
  'had_user_correction',
  'final_reading',
  'per_dial_compact',
  'field_test_capture',
  'test_data_review_status',
  'test_data_unit_test_s3_key',
  'test_data_unit_test_file_name',
  'test_data_approved_at',
  'test_data_submitted_at',
  'test_data_submitted_by',
  'manual_label_pending',
  'primary_image_key',
  'image_count',
  'capture_location',
  'review_assignment_batch_id',
  'review_assigned_to',
  'review_assigned_at',
  'review_assigned_by',
].join(', ');

function cleanItem(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function gsi1QueryJobs(source, portalWorkType) {
  const sources = source === 'all' ? ['field', 'simulator'] : [source];
  const statuses = ALL_STATUSES.filter((s) => s !== 'manually_uploaded');
  /** @type {{ gsi1pk: string, status?: string }[]} */
  const jobs = [];
  for (const src of sources) {
    for (const status of statuses) {
      jobs.push({ gsi1pk: buildGsi1Pk(portalWorkType, status, src), status });
    }
  }
  if (source === 'all' || source === 'simulator') {
    jobs.push({
      gsi1pk: buildGsi1Pk(portalWorkType, 'manually_uploaded', 'simulator'),
      status: 'manually_uploaded',
    });
  }
  return jobs;
}

/**
 * @param {object} opts
 * @param {string} opts.tableName
 * @param {string} opts.region
 * @param {object} [opts.credentials]
 */
export function createSessionIndexStore({ tableName, region, credentials } = {}) {
  if (!tableName) {
    return {
      enabled: false,
      tableName: null,
      async upsertFromMetadata() {},
      async updateAfterMove() {},
      async getBySessionId() { return null; },
      async queryReadings() { return null; },
      async queryReadingsByFolderStatus() { return null; },
      async queryCounts() { return null; },
      async countUploadedOnPortalDay() { return 0; },
    };
  }

  const client = new DynamoDBClient({
    region: region || 'us-east-1',
    ...(credentials ? { credentials } : {}),
  });

  async function putItem(item) {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(cleanItem(item), { removeUndefinedValues: true }),
      }),
    );
  }

  async function upsertFromMetadata(metadata, ctx) {
    const item = metadataToSessionItem(metadata, ctx);
    await putItem(item);
    return item;
  }

  async function updateAfterMove({ sessionId, s3SessionPrefix, folderStatus, sourceType, portalWorkType, capturedAt }) {
    const sid = String(sessionId || '').trim();
    const prefix = normalizeS3SessionPrefix(s3SessionPrefix);
    if (!sid || !prefix) return;

    const inferred = inferStatusAndSourceFromSessionPrefix(prefix);
    const status = folderStatus || inferred.status;
    const src = sourceType || inferred.sourceType;
    const wt = portalWorkType || '1000';
    const ts = capturedAt || new Date().toISOString();

    await client.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ session_id: sid }),
        UpdateExpression:
          'SET s3_session_prefix = :p, folder_status = :st, source_type = :src, portal_work_type = :wt, gsi1pk = :pk, gsi1sk = :sk, updated_at = :now',
        ExpressionAttributeValues: marshall({
          ':p': prefix,
          ':st': status,
          ':src': src,
          ':wt': wt,
          ':pk': buildGsi1Pk(wt, status, src),
          ':sk': buildGsi1Sk(ts, sid),
          ':now': new Date().toISOString(),
        }),
      }),
    );
  }

  async function getBySessionId(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const out = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: marshall({ session_id: sid }),
      }),
    );
    if (!out.Item) return null;
    return unmarshall(out.Item);
  }

  async function queryGsi1(gsi1pk, { projection } = {}) {
    /** @type {object[]} */
    const items = [];
    let exclusiveStartKey;
    do {
      /** @type {import('@aws-sdk/client-dynamodb').QueryCommandInput} */
      const input = {
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: marshall({ ':pk': gsi1pk }),
        ExclusiveStartKey: exclusiveStartKey,
      };
      if (projection) input.ProjectionExpression = projection;
      const out = await client.send(new QueryCommand(input));
      for (const row of out.Items || []) {
        items.push(unmarshall(row));
      }
      exclusiveStartKey = out.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async function countGsi1(gsi1pk) {
    let count = 0;
    let exclusiveStartKey;
    do {
      const out = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': gsi1pk }),
          Select: 'COUNT',
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      count += out.Count || 0;
      exclusiveStartKey = out.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return count;
  }

  async function queryReadings(source = 'all', portalWorkType = '1000') {
    const jobs = gsi1QueryJobs(source, portalWorkType);
    const chunks = await Promise.all(
      jobs.map(({ gsi1pk }) => queryGsi1(gsi1pk, { projection: LIST_READING_PROJECTION })),
    );
    const readings = dedupeReadings(
      chunks.flat().map((item) => sessionItemToReading(item, { images: [] })).filter(Boolean),
    );
    readings.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));
    return readings;
  }

  /** Query one folder status across field and/or simulator (e.g. incorrect_new awaiting review). */
  async function queryReadingsByFolderStatus(
    portalWorkType = '1000',
    folderStatus = 'incorrect_new',
    sources = ['field', 'simulator'],
  ) {
    const wt = String(portalWorkType || '1000').trim() || '1000';
    const status = String(folderStatus || '').trim();
    const srcs = (sources || []).map((s) => String(s || '').trim()).filter(Boolean);
    if (!status || srcs.length === 0) return [];
    const chunks = await Promise.all(
      srcs.map((src) =>
        queryGsi1(buildGsi1Pk(wt, status, src), { projection: LIST_READING_PROJECTION }),
      ),
    );
    const readings = dedupeReadings(
      chunks.flat().map((item) => sessionItemToReading(item, { images: [] })).filter(Boolean),
    );
    readings.sort((a, b) => new Date(b.dateOfReading) - new Date(a.dateOfReading));
    return readings;
  }

  async function queryLightReadings(source = 'all', portalWorkType = '1000') {
    return queryReadings(source, portalWorkType);
  }

  /** Full items (includes dial_details) for field-test rollup rebuild. */
  async function queryReadingItems(source = 'all', portalWorkType = '1000') {
    const jobs = gsi1QueryJobs(source, portalWorkType);
    const chunks = await Promise.all(jobs.map(({ gsi1pk }) => queryGsi1(gsi1pk)));
    const byId = new Map();
    for (const item of chunks.flat()) {
      if (!item?.session_id) continue;
      byId.set(item.session_id, item);
    }
    return [...byId.values()].sort((a, b) =>
      String(b.captured_at || '').localeCompare(String(a.captured_at || '')),
    );
  }

  /** Count sessions whose captured_at falls on portal calendar day (dayKey = YYYY-MM-DD). */
  async function countUploadedOnPortalDay(source = 'all', portalWorkType = '1000', dayKey, dayKeyFromIso) {
    const jobs = gsi1QueryJobs(source, portalWorkType);
    const chunks = await Promise.all(
      jobs.map(({ gsi1pk }) => queryGsi1(gsi1pk, { projection: 'captured_at' })),
    );
    let n = 0;
    for (const item of chunks.flat()) {
      const ts = item?.captured_at;
      if (ts && dayKeyFromIso(String(ts)) === dayKey) n += 1;
    }
    return n;
  }

  async function queryCounts(source = 'all', portalWorkType = '1000') {
    const sources = source === 'all' ? ['field', 'simulator'] : [source];
    const statuses = ALL_STATUSES;

    const counts = {
      totalPictures: 0,
      correctCount: 0,
      incorrectNewCount: 0,
      incorrectAnalyzedCount: 0,
      incorrectLabeledCount: 0,
      incorrectTrainingCount: 0,
      noDialsCount: 0,
      notSureCount: 0,
      manuallyUploadedCount: 0,
    };

    const statusToKey = {
      correct: 'correctCount',
      incorrect_new: 'incorrectNewCount',
      incorrect_analyzed: 'incorrectAnalyzedCount',
      incorrect_labeled: 'incorrectLabeledCount',
      incorrect_training: 'incorrectTrainingCount',
      no_dials: 'noDialsCount',
      not_sure: 'notSureCount',
      manually_uploaded: 'manuallyUploadedCount',
    };

    /** @type {Promise<{ status: string, count: number }>[]} */
    const jobs = [];
    for (const src of sources) {
      for (const status of statuses) {
        if (status === 'manually_uploaded') continue;
        jobs.push(
          countGsi1(buildGsi1Pk(portalWorkType, status, src)).then((count) => ({ status, count })),
        );
      }
    }
    if (source === 'all' || source === 'simulator') {
      jobs.push(
        countGsi1(buildGsi1Pk(portalWorkType, 'manually_uploaded', 'simulator')).then((count) => ({
          status: 'manually_uploaded',
          count,
        })),
      );
    }

    const results = await Promise.all(jobs);
    for (const { status, count } of results) {
      const key = statusToKey[status];
      if (key) counts[key] += count;
      counts.totalPictures += count;
    }

    return counts;
  }

  return {
    enabled: true,
    tableName,
    client,
    upsertFromMetadata,
    updateAfterMove,
    getBySessionId,
    queryReadings,
    queryReadingsByFolderStatus,
    queryLightReadings,
    queryReadingItems,
    queryCounts,
    countUploadedOnPortalDay,
    putItem,
  };
}
