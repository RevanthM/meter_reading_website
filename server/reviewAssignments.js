/**
 * Reviewer assignment batches — S3 manifests + metadata/Dynamo assignee fields.
 */
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { appendAuditEvents } from './auditEvents.js';
import {
  loadPoolReadings,
  filterPoolReadings,
  splitSessionIdsAmongAssignees,
  batchProgressForSessions,
  REVIEW_ASSIGNMENT_POOLS,
} from './reviewAssignmentPool.js';
import { syncSessionIndexFromMetadata } from './sessionIndex/syncHelper.js';
import { normalizeS3SessionPrefix } from './sessionIndex/prefixInfer.js';

const ASSIGNMENTS_PREFIX = 'portal-admin/review-assignments';

function assignmentsPrefix(workType) {
  return `${ASSIGNMENTS_PREFIX}/${String(workType || '1000').trim() || '1000'}`;
}

function batchObjectKey(workType, batchId) {
  return `${assignmentsPrefix(workType)}/batches/${batchId}.json`;
}

async function streamToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(s3Client, bucket, key) {
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await streamToString(out.Body);
    return JSON.parse(text);
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function writeJson(s3Client, bucket, key, data) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }),
  );
}

async function listBatchKeys(s3Client, bucket, workType) {
  const prefix = `${assignmentsPrefix(workType)}/batches/`;
  const keys = [];
  let token;
  do {
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 500,
      }),
    );
    for (const o of out.Contents || []) {
      if (o.Key?.endsWith('.json')) keys.push(o.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRules(raw) {
  return {
    dateFrom: String(raw?.dateFrom || '').trim() || null,
    dateTo: String(raw?.dateTo || '').trim() || null,
    firstN: Math.max(0, parseInt(String(raw?.firstN ?? '0'), 10) || 0),
    corrected: ['all', 'yes', 'no'].includes(String(raw?.corrected || 'all').toLowerCase())
      ? String(raw.corrected).toLowerCase()
      : 'all',
    cohort: String(raw?.cohort || 'untrained').trim().toLowerCase() || 'untrained',
    sort: raw?.sort === 'date_desc' ? 'date_desc' : 'date_asc',
  };
}

function summarizeBatch(batch) {
  if (!batch || typeof batch !== 'object') {
    return {
      id: '',
      name: 'Unknown batch',
      pool: 'field_test',
      workType: '1000',
      status: 'closed',
      createdAt: '',
      createdBy: '',
      rules: {},
      totalAssigned: 0,
      assignees: [],
    };
  }
  const slices = batch.assignments || [];
  const totalAssigned = slices.reduce((n, s) => n + (s.sessionIds?.length || 0), 0);
  return {
    id: batch.id,
    name: batch.name,
    pool: batch.pool,
    workType: batch.workType,
    status: batch.status === 'closed' ? 'closed' : 'open',
    createdAt: batch.createdAt,
    createdBy: batch.createdBy,
    rules: batch.rules,
    totalAssigned,
    assignees: slices.map((s) => ({
      email: s.assigneeEmail,
      count: s.sessionIds?.length || 0,
      reviewed: s.progress?.reviewed ?? null,
      remaining: s.progress?.remaining ?? null,
    })),
  };
}

/**
 * @param {object} deps
 */
export function registerReviewAssignmentRoutes(app, deps) {
  const {
    s3Client,
    bucket,
    sessionIndex,
    requireAdmin,
    getUserEmail = (req) => String(req.headers['x-user-email'] || '').trim(),
  } = deps;

  async function loadOpenAssignedSessionIds(workType) {
    const keys = await listBatchKeys(s3Client, bucket, workType);
    const exclude = new Set();
    for (const key of keys) {
      const batch = await readJson(s3Client, bucket, key);
      if (!batch || batch.status !== 'open') continue;
      for (const slice of batch.assignments || []) {
        for (const id of slice.sessionIds || []) exclude.add(String(id));
      }
    }
    return exclude;
  }

  async function assignSessionMetadata({ sessionId, s3SessionPrefix, workType, batchId, assigneeEmail, assignedBy }) {
    const prefix = normalizeS3SessionPrefix(s3SessionPrefix);
    if (!prefix) throw new Error(`Missing s3 prefix for ${sessionId}`);
    const metaKey = `${prefix}metadata.json`;
    const getOut = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: metaKey }));
    const meta = JSON.parse(await streamToString(getOut.Body));
    if (String(meta.session_id) !== String(sessionId)) {
      throw new Error(`metadata session_id mismatch for ${sessionId}`);
    }
    const now = new Date().toISOString();
    meta.review_assignment_batch_id = batchId;
    meta.review_assigned_to = assigneeEmail;
    meta.review_assigned_at = now;
    meta.review_assigned_by = assignedBy;
    meta.portal_metadata_updated_at = now;
    meta.portal_metadata_updated_by = assignedBy;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: metaKey,
        Body: JSON.stringify(meta, null, 2),
        ContentType: 'application/json',
      }),
    );

    if (sessionIndex?.enabled) {
      await syncSessionIndexFromMetadata(sessionIndex, meta, {
        s3SessionPrefix: prefix,
        s3Bucket: bucket,
        portalWorkType: workType,
        ingestSource: 'portal_assignment',
      });
    }
    return meta;
  }

  app.post('/api/review-assignments/preview', async (req, res) => {
    try {
      if (requireAdmin && !requireAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const workType = String(req.body?.workType || '1000').trim() || '1000';
      const pool = String(req.body?.pool || '').trim();
      if (!REVIEW_ASSIGNMENT_POOLS.includes(pool)) {
        return res.status(400).json({ error: 'pool must be field_test or awaiting_review' });
      }
      const rules = normalizeRules(req.body?.rules || {});
      const readings = await loadPoolReadings({ sessionIndex, workType, pool });
      const exclude = await loadOpenAssignedSessionIds(workType);
      const { selected, totalMatching } = filterPoolReadings(readings, rules, exclude);
      const { totalMatching: matchingIgnoringOpenBatches } = filterPoolReadings(
        readings,
        rules,
        new Set(),
      );
      const blockedByOpenBatches = Math.max(0, matchingIgnoringOpenBatches - totalMatching);
      const assignees = Array.isArray(req.body?.assignees)
        ? req.body.assignees.map((e) => normalizeEmail(e)).filter(Boolean)
        : [];
      const slices =
        assignees.length > 0
          ? splitSessionIdsAmongAssignees(
              selected.map((r) => r.id),
              assignees,
              req.body?.splitMode || 'equal',
            )
          : [];

      res.json({
        pool,
        workType,
        rules,
        totalInPool: readings.length,
        totalMatching,
        blockedByOpenBatches,
        excludedAlreadyAssigned: blockedByOpenBatches,
        willAssign: selected.length,
        previewIds: selected.slice(0, 20).map((r) => r.id),
        splitPreview: slices.map((s) => ({
          assigneeEmail: s.assigneeEmail,
          count: s.sessionIds.length,
        })),
      });
    } catch (e) {
      console.error('POST /api/review-assignments/preview:', e);
      res.status(500).json({ error: e.message || 'Preview failed' });
    }
  });

  app.post('/api/review-assignments', async (req, res) => {
    try {
      if (requireAdmin && !requireAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const workType = String(req.body?.workType || '1000').trim() || '1000';
      const pool = String(req.body?.pool || '').trim();
      const name = String(req.body?.name || '').trim() || 'Assignment';
      if (!REVIEW_ASSIGNMENT_POOLS.includes(pool)) {
        return res.status(400).json({ error: 'pool must be field_test or awaiting_review' });
      }
      const rules = normalizeRules(req.body?.rules || {});
      const assignees = Array.isArray(req.body?.assignees)
        ? [...new Set(req.body.assignees.map((e) => normalizeEmail(e)).filter(Boolean))]
        : [];
      if (assignees.length === 0) {
        return res.status(400).json({ error: 'At least one assignee email required' });
      }

      const readings = await loadPoolReadings({ sessionIndex, workType, pool });
      const exclude = await loadOpenAssignedSessionIds(workType);
      const { selected } = filterPoolReadings(readings, rules, exclude);
      if (selected.length === 0) {
        return res.status(400).json({ error: 'No sessions match rules (or all are already assigned)' });
      }

      const byId = new Map(readings.map((r) => [String(r.id), r]));
      const slices = splitSessionIdsAmongAssignees(
        selected.map((r) => r.id),
        assignees,
        req.body?.splitMode || 'equal',
      );

      const batchId = randomUUID();
      const createdBy = normalizeEmail(getUserEmail(req)) || 'admin';
      const createdAt = new Date().toISOString();
      const errors = [];

      for (const slice of slices) {
        for (const sessionId of slice.sessionIds) {
          const reading = byId.get(String(sessionId));
          if (!reading?.s3SessionPrefix) {
            errors.push({ sessionId, error: 'missing s3SessionPrefix' });
            continue;
          }
          try {
            await assignSessionMetadata({
              sessionId,
              s3SessionPrefix: reading.s3SessionPrefix,
              workType,
              batchId,
              assigneeEmail: slice.assigneeEmail,
              assignedBy: createdBy,
            });
          } catch (err) {
            errors.push({ sessionId, error: err.message || 'assign failed' });
          }
        }
        const prog = batchProgressForSessions(byId, slice.sessionIds);
        slice.progress = prog;
      }

      const batch = {
        id: batchId,
        name,
        pool,
        workType,
        status: 'open',
        createdAt,
        createdBy,
        rules,
        assignments: slices,
      };

      await writeJson(s3Client, bucket, batchObjectKey(workType, batchId), batch);

      try {
        await appendAuditEvents(s3Client, bucket, [
          {
            action: 'assignment.batch_created',
            intent: `Created ${pool} assignment "${name}" (${selected.length} sessions)`,
            actor: { email: createdBy, role: 'admin' },
            target: { sessionId: null, workType },
            detail: { batchId, pool, assignees, assigned: selected.length, errors: errors.length },
          },
        ]);
      } catch (auditErr) {
        console.warn('assignment audit log failed:', auditErr);
      }

      res.status(201).json({ batch: summarizeBatch(batch), errors });
    } catch (e) {
      console.error('POST /api/review-assignments:', e);
      res.status(500).json({ error: e.message || 'Create assignment failed' });
    }
  });

  async function enrichBatchProgress(batch) {
    if (!sessionIndex?.enabled) return batch;
    const wt = batch.workType || '1000';
    const poolReadings = await loadPoolReadings({ sessionIndex, workType: wt, pool: batch.pool });
    const byId = new Map(poolReadings.map((r) => [String(r.id), r]));
    for (const slice of batch.assignments || []) {
      slice.progress = batchProgressForSessions(byId, slice.sessionIds || []);
    }
    return batch;
  }

  app.get('/api/review-assignments', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const isAdmin = !requireAdmin || requireAdmin(req);
      const mine = String(req.query.mine || '').trim() === '1' || req.query.mine === 'true';
      const email = normalizeEmail(getUserEmail(req));
      const poolFilter = String(req.query.pool || '').trim();

      const keys = await listBatchKeys(s3Client, bucket, workType);
      const batches = [];
      for (const key of keys) {
        const batch = await readJson(s3Client, bucket, key);
        if (!batch) continue;
        if (poolFilter && batch.pool !== poolFilter) continue;
        await enrichBatchProgress(batch);
        if (mine && email) {
          const mySlice = (batch.assignments || []).find((s) => normalizeEmail(s.assigneeEmail) === email);
          if (!mySlice) continue;
          batches.push({
            ...summarizeBatch(batch),
            mySessionIds: mySlice.sessionIds,
            myProgress: mySlice.progress,
          });
        } else if (isAdmin) {
          batches.push(summarizeBatch(batch));
        }
      }
      batches.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!isAdmin && !mine) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      res.json({ batches });
    } catch (e) {
      console.error('GET /api/review-assignments:', e);
      res.status(500).json({ error: e.message || 'List assignments failed' });
    }
  });

  app.get('/api/review-assignments/:batchId', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const batchId = String(req.params.batchId || '').trim();
      const batch = await readJson(s3Client, bucket, batchObjectKey(workType, batchId));
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      await enrichBatchProgress(batch);
      const email = normalizeEmail(getUserEmail(req));
      const isAdmin = !requireAdmin || requireAdmin(req);
      if (!isAdmin && email) {
        const mySlice = (batch.assignments || []).find((s) => normalizeEmail(s.assigneeEmail) === email);
        if (!mySlice) return res.status(403).json({ error: 'Not assigned to this batch' });
        return res.json({
          batch: summarizeBatch(batch),
          mySessionIds: mySlice.sessionIds,
          myProgress: mySlice.progress,
        });
      }
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      res.json({ batch: summarizeBatch(batch), full: batch });
    } catch (e) {
      console.error('GET /api/review-assignments/:batchId:', e);
      res.status(500).json({ error: e.message || 'Load batch failed' });
    }
  });

  app.patch('/api/review-assignments/:batchId', async (req, res) => {
    try {
      if (requireAdmin && !requireAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const workType = String(req.body?.workType || req.query.workType || '1000').trim() || '1000';
      const batchId = String(req.params.batchId || '').trim();
      const key = batchObjectKey(workType, batchId);
      const batch = await readJson(s3Client, bucket, key);
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      const status = String(req.body?.status || '').trim().toLowerCase();
      if (status === 'open' || status === 'closed') {
        batch.status = status;
        batch.closedAt = status === 'closed' ? new Date().toISOString() : null;
      }
      await writeJson(s3Client, bucket, key, batch);
      res.json({ batch: summarizeBatch(batch) });
    } catch (e) {
      console.error('PATCH /api/review-assignments/:batchId:', e);
      res.status(500).json({ error: e.message || 'Update batch failed' });
    }
  });
}
