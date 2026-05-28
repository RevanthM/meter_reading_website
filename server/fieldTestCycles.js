/**
 * Field test cycle registry on S3 (`{workType}/field_test_cycles/registry.json`).
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { fieldTestRollupKey } from './fieldTestAnalytics.js';
import { fieldTestCaptureDayKey } from './fieldTestCaptureDay.js';
import { randomUUID } from 'node:crypto';

const REGISTRY_FILE = 'registry.json';

export function fieldTestCyclesRegistryKey(workType) {
  const wt = String(workType || '1000').trim() || '1000';
  return `${wt}/field_test_cycles/${REGISTRY_FILE}`;
}

function normalizeCycle(raw) {
  return {
    id: String(raw.id || '').trim() || randomUUID(),
    name: String(raw.name || '').trim() || 'Untitled cycle',
    workType: String(raw.workType || raw.work_type || '1000').trim() || '1000',
    startDate: String(raw.startDate || raw.start_date || '').slice(0, 10),
    endDate: String(raw.endDate || raw.end_date || '').slice(0, 10),
    status: raw.status === 'closed' ? 'closed' : raw.status === 'active' ? 'active' : 'draft',
    notes: String(raw.notes || '').trim(),
    createdAt: String(raw.createdAt || raw.created_at || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.updated_at || new Date().toISOString()),
  };
}

function dayInRange(day, startDate, endDate) {
  if (!day || !startDate || !endDate) return false;
  return day >= startDate && day <= endDate;
}

export function captureDayFromIso(iso) {
  const day = fieldTestCaptureDayKey(iso);
  return day || null;
}

export async function readFieldTestCycles(s3Client, bucket, workType) {
  const key = fieldTestCyclesRegistryKey(workType);
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await out.Body.transformToString();
    const doc = JSON.parse(text);
    const cycles = (Array.isArray(doc?.cycles) ? doc.cycles : []).map(normalizeCycle);
    return {
      key,
      updatedAt: doc?.updatedAt || null,
      cycles: cycles.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    };
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return { key, updatedAt: null, cycles: [] };
    }
    throw e;
  }
}

export async function writeFieldTestCycles(s3Client, bucket, workType, cycles) {
  const key = fieldTestCyclesRegistryKey(workType);
  const body = JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      cycles: cycles.map(normalizeCycle),
    },
    null,
    2,
  );
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
    }),
  );
  return key;
}

export function pickActiveCycle(cycles) {
  const active = cycles.filter((c) => c.status === 'active');
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
}

/** @deprecated Use filterSessionsForCycle from fieldTestAnalytics.js */
export function filterManifestRowsForCycle(rows, cycle) {
  if (!cycle) return rows;
  return rows.filter((row) => {
    const day = captureDayFromIso(row.captured_at);
    return dayInRange(day, cycle.startDate, cycle.endDate);
  });
}

export async function createFieldTestCycle(s3Client, bucket, payload) {
  const workType = String(payload.workType || '1000').trim() || '1000';
  const { cycles } = await readFieldTestCycles(s3Client, bucket, workType);
  const next = normalizeCycle({
    ...payload,
    id: randomUUID(),
    workType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  if (next.status === 'active') {
    for (const c of cycles) {
      if (c.status === 'active') c.status = 'closed';
    }
  }
  cycles.push(next);
  const key = await writeFieldTestCycles(s3Client, bucket, workType, cycles);
  return { key, cycle: next, cycles };
}

export async function updateFieldTestCycle(s3Client, bucket, workType, cycleId, patch) {
  const doc = await readFieldTestCycles(s3Client, bucket, workType);
  const idx = doc.cycles.findIndex((c) => c.id === cycleId);
  if (idx < 0) return null;
  const updated = normalizeCycle({
    ...doc.cycles[idx],
    ...patch,
    id: cycleId,
    workType,
    updatedAt: new Date().toISOString(),
  });
  if (updated.status === 'active') {
    for (const c of doc.cycles) {
      if (c.id !== cycleId && c.status === 'active') c.status = 'closed';
    }
  }
  doc.cycles[idx] = updated;
  const key = await writeFieldTestCycles(s3Client, bucket, workType, doc.cycles);
  return { key, cycle: updated, cycles: doc.cycles };
}

export async function deleteFieldTestCycle(s3Client, bucket, workType, cycleId) {
  const doc = await readFieldTestCycles(s3Client, bucket, workType);
  const idx = doc.cycles.findIndex((c) => c.id === cycleId);
  if (idx < 0) return null;
  const [removed] = doc.cycles.splice(idx, 1);
  const key = await writeFieldTestCycles(s3Client, bucket, workType, doc.cycles);
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: fieldTestRollupKey(workType, cycleId),
      }),
    );
  } catch {
    /* rollup may not exist */
  }
  return { key, cycle: removed, cycles: doc.cycles };
}
