/**
 * Sync / audit events — S3-backed trail for iOS capture→upload and portal actions.
 */
import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { calendarDayKeyInPortalTz } from './improvementAnalytics.js';

const AUDIT_PREFIX = 'portal-admin/audit-events';

function auditDayKey(isoTs) {
  const d = calendarDayKeyInPortalTz(isoTs || new Date().toISOString());
  return d || new Date().toISOString().slice(0, 10);
}

function auditObjectKey(day, id) {
  return `${AUDIT_PREFIX}/${day}/${id}.json`;
}

function normalizeActor(raw, headers = {}) {
  const email = String(raw?.email ?? headers['x-user-email'] ?? '').trim();
  const name = String(raw?.userName ?? raw?.name ?? '').trim();
  return {
    email: email || null,
    userName: name || email || null,
    role: String(raw?.role ?? headers['x-portal-work-mode'] ?? '').trim() || null,
  };
}

/** @param {object} raw */
export function normalizeAuditEvent(raw, headers = {}) {
  const ts = String(raw?.ts ?? raw?.timestamp ?? new Date().toISOString());
  const id = String(raw?.id ?? randomUUID());
  const action = String(raw?.action ?? '').trim();
  if (!action) return null;

  const target = raw?.target && typeof raw.target === 'object' ? raw.target : {};
  const detail = raw?.detail && typeof raw.detail === 'object' ? raw.detail : {};

  return {
    id,
    ts,
    source: String(raw?.source ?? 'portal').trim() || 'portal',
    actor: normalizeActor(raw?.actor, headers),
    action,
    intent: String(raw?.intent ?? '').trim() || null,
    target: {
      sessionId: target.sessionId != null ? String(target.sessionId) : null,
      workType: target.workType != null ? String(target.workType) : null,
      imageSignature: target.imageSignature != null ? String(target.imageSignature) : null,
    },
    detail,
    outcome: String(raw?.outcome ?? 'success').trim() || 'success',
    error: raw?.error != null ? String(raw.error).slice(0, 2000) : null,
    client: raw?.client && typeof raw.client === 'object' ? raw.client : {},
  };
}

async function streamToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {object[]} events
 */
export async function appendAuditEvents(s3Client, bucket, events, headers = {}) {
  const written = [];
  for (const raw of events) {
    const event = normalizeAuditEvent(raw, headers);
    if (!event) continue;
    const day = auditDayKey(event.ts);
    const key = auditObjectKey(day, event.id);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(event),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
    written.push(event);
  }
  return written;
}

function daysBetween(fromDay, toDay) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return out;
  const start = new Date(`${fromDay}T12:00:00Z`);
  const end = new Date(`${toDay}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  for (let d = new Date(lo); d <= hi; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function actorMatches(event, userName) {
  const needle = String(userName || '').trim().toLowerCase();
  if (!needle) return true;
  const a = event?.actor || {};
  const name = String(a.userName || '').trim().toLowerCase();
  const email = String(a.email || '').trim().toLowerCase();
  return name === needle || email === needle;
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {{ from?: string, to?: string, userName?: string, sessionId?: string, action?: string, limit?: number }} opts
 */
export async function listAuditEvents(s3Client, bucket, opts = {}) {
  const to = opts.to || calendarDayKeyInPortalTz(new Date().toISOString());
  const from = opts.from || to;
  const limit = Math.min(Math.max(parseInt(String(opts.limit || '500'), 10) || 500, 1), 2000);
  const days = daysBetween(from, to);
  const events = [];

  for (const day of days) {
    let token;
    const prefix = `${AUDIT_PREFIX}/${day}/`;
    do {
      const out = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 200,
        }),
      );
      for (const obj of out.Contents || []) {
        if (!obj.Key?.endsWith('.json')) continue;
        try {
          const got = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
          const parsed = JSON.parse(await streamToString(got.Body));
          if (opts.sessionId && String(parsed?.target?.sessionId || '') !== String(opts.sessionId)) {
            continue;
          }
          if (opts.action && String(parsed?.action || '') !== String(opts.action)) continue;
          if (!actorMatches(parsed, opts.userName)) continue;
          events.push(parsed);
        } catch {
          /* skip corrupt */
        }
        if (events.length >= limit) break;
      }
      if (events.length >= limit) break;
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    if (events.length >= limit) break;
  }

  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return events.slice(0, limit);
}

/**
 * Reconcile device audit events vs portal sessions for a collector + date range.
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {{ userName: string, from: string, to: string, getPortalSessions?: (userName: string, from: string, to: string) => Promise<object[]> }} opts
 */
export async function buildSyncSummary(s3Client, bucket, opts) {
  const userName = String(opts.userName || '').trim();
  const from = opts.from || calendarDayKeyInPortalTz(new Date().toISOString());
  const to = opts.to || from;

  const events = await listAuditEvents(s3Client, bucket, {
    from,
    to,
    userName,
    limit: 5000,
  });

  const sessions = new Map();

  const touch = (sessionId, patch) => {
    const sid = sessionId || '_unknown_';
    const row = sessions.get(sid) || {
      sessionId: sessionId || null,
      imageSignature: null,
      queued: false,
      uploadStarted: false,
      uploadSucceeded: false,
      uploadFailed: false,
      lastAction: null,
      lastTs: null,
      lastError: null,
      feedbackType: null,
    };
    sessions.set(sid, { ...row, ...patch });
  };

  for (const e of events) {
    const sid = e?.target?.sessionId || null;
    const sig = e?.target?.imageSignature || null;
    const action = String(e?.action || '');
    const base = { lastAction: action, lastTs: e.ts, imageSignature: sig || undefined };
    if (action === 'capture.queued') {
      touch(sid, { ...base, queued: true, feedbackType: e.detail?.feedbackType ?? null });
    } else if (action === 'upload.started') {
      touch(sid, { ...base, uploadStarted: true });
    } else if (action === 'upload.succeeded') {
      touch(sid, { ...base, uploadSucceeded: true, uploadFailed: false });
    } else if (action === 'upload.failed') {
      touch(sid, {
        ...base,
        uploadFailed: true,
        lastError: e.error || e.detail?.message || null,
      });
    } else if (action === 'sync.batch_completed') {
      /* aggregate only */
    }
  }

  let portalInRange = 0;
  if (typeof opts.getPortalSessions === 'function' && userName) {
    try {
      const rows = await opts.getPortalSessions(userName, from, to);
      portalInRange = rows.length;
    } catch {
      portalInRange = 0;
    }
  }

  const rows = [...sessions.values()];
  const queuedCount = rows.filter((r) => r.queued).length;
  const uploadSucceeded = rows.filter((r) => r.uploadSucceeded).length;
  const uploadFailed = rows.filter((r) => r.uploadFailed).length;
  const pendingUpload = rows.filter((r) => r.queued && !r.uploadSucceeded).length;

  const batchEvents = events.filter((e) => e.action === 'sync.batch_completed');
  const lastBatch = batchEvents[0] || null;

  return {
    userName,
    from,
    to,
    eventCount: events.length,
    uniqueSessions: rows.length,
    queuedCount,
    uploadStarted: rows.filter((r) => r.uploadStarted).length,
    uploadSucceeded,
    uploadFailed,
    pendingUpload,
    portalSessionsInRange: portalInRange,
    gapVsPortal: Math.max(0, queuedCount - portalInRange),
    lastBatch: lastBatch
      ? {
          ts: lastBatch.ts,
          uploaded: lastBatch.detail?.uploaded ?? null,
          failed: lastBatch.detail?.failed ?? null,
        }
      : null,
    sessions: rows.sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || ''))),
  };
}

export function registerAuditEventRoutes(app, deps) {
  const { s3Client, bucket, requireAdmin, getPortalSessionsForUser } = deps;

  app.post('/api/audit-events', async (req, res) => {
    try {
      const body = req.body;
      const rawEvents = Array.isArray(body?.events) ? body.events : body ? [body] : [];
      if (rawEvents.length === 0) {
        return res.status(400).json({ error: 'events array required' });
      }
      if (rawEvents.length > 100) {
        return res.status(400).json({ error: 'Max 100 events per request' });
      }
      const written = await appendAuditEvents(s3Client, bucket, rawEvents, req.headers);
      res.status(201).json({ ok: true, written: written.length, events: written });
    } catch (e) {
      console.error('POST /api/audit-events:', e);
      res.status(500).json({ error: e.message || 'Failed to store audit events' });
    }
  });

  app.get('/api/audit-events', async (req, res) => {
    try {
      if (requireAdmin && !requireAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const events = await listAuditEvents(s3Client, bucket, {
        from: String(req.query.from || '').trim() || undefined,
        to: String(req.query.to || '').trim() || undefined,
        userName: String(req.query.userName || '').trim() || undefined,
        sessionId: String(req.query.sessionId || '').trim() || undefined,
        action: String(req.query.action || '').trim() || undefined,
        limit: req.query.limit,
      });
      res.json({ events });
    } catch (e) {
      console.error('GET /api/audit-events:', e);
      res.status(500).json({ error: e.message || 'Failed to list audit events' });
    }
  });

  app.get('/api/audit-events/sync-summary', async (req, res) => {
    try {
      if (requireAdmin && !requireAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const userName = String(req.query.userName || '').trim();
      if (!userName) {
        return res.status(400).json({ error: 'userName query is required' });
      }
      const from =
        String(req.query.from || '').trim() ||
        calendarDayKeyInPortalTz(new Date().toISOString());
      const to = String(req.query.to || '').trim() || from;

      const summary = await buildSyncSummary(s3Client, bucket, {
        userName,
        from,
        to,
        getPortalSessions: getPortalSessionsForUser,
      });
      res.json(summary);
    } catch (e) {
      console.error('GET /api/audit-events/sync-summary:', e);
      res.status(500).json({ error: e.message || 'Failed to build sync summary' });
    }
  });
}
