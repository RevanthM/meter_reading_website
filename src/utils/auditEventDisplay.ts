import type { AuditEventRecord } from '../services/api';

const ACTION_LABELS: Record<string, string> = {
  'capture.queued': 'Saved on device',
  'upload.started': 'Upload started',
  'upload.succeeded': 'Uploaded to portal',
  'upload.failed': 'Upload failed',
  'sync.batch_started': 'Batch upload started',
  'sync.batch_completed': 'Batch upload finished',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/\./g, ' · ');
}

export function auditActorLabel(event: AuditEventRecord): string {
  const a = event.actor || {};
  return (a.userName || a.email || 'Unknown').trim() || 'Unknown';
}

export function auditOutcomeTone(outcome: string, error?: string | null): 'ok' | 'fail' | 'neutral' {
  if (error || outcome === 'failure' || outcome === 'failed') return 'fail';
  if (outcome === 'success') return 'ok';
  return 'neutral';
}

export function formatAuditTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
  } catch {
    return ts;
  }
}

export function auditDetailEntries(event: AuditEventRecord): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  if (event.intent) rows.push({ key: 'Intent', value: event.intent });
  if (event.source) rows.push({ key: 'Source', value: event.source });
  if (event.target?.workType) rows.push({ key: 'Work type', value: event.target.workType });
  if (event.target?.imageSignature) rows.push({ key: 'Image signature', value: event.target.imageSignature });
  const client = event.client as { platform?: string; appVersion?: string } | undefined;
  if (client?.appVersion) {
    rows.push({ key: 'App', value: `${client.appVersion}${client.platform ? ` (${client.platform})` : ''}` });
  }
  if (event.error) rows.push({ key: 'Error', value: event.error });
  for (const [key, value] of Object.entries(event.detail || {})) {
    if (value == null || value === '') continue;
    rows.push({ key: key.replace(/_/g, ' '), value: String(value) });
  }
  rows.push({ key: 'Event id', value: event.id });
  return rows;
}
