export type FieldTestCaptureTriggerFilter = 'all' | 'auto' | 'manual' | 'gallery';

export const FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS: {
  id: FieldTestCaptureTriggerFilter;
  label: string;
}[] = [
  { id: 'all', label: 'All capture types' },
  { id: 'auto', label: 'Auto-capture' },
  { id: 'manual', label: 'Manual shutter' },
  { id: 'gallery', label: 'Gallery' },
];

export function normalizeFieldTestCaptureTrigger(
  reading: { captureTrigger?: string | null; imageSource?: string | null },
): FieldTestCaptureTriggerFilter | '' {
  const raw = String(reading.captureTrigger || '').trim().toLowerCase();
  if (raw === 'auto' || raw === 'manual' || raw === 'gallery') return raw;
  if (String(reading.imageSource || '').trim().toLowerCase() === 'gallery') return 'gallery';
  return '';
}

export function fieldTestCaptureTriggerLabel(
  reading: { captureTrigger?: string | null; imageSource?: string | null },
): string {
  const value = normalizeFieldTestCaptureTrigger(reading);
  if (value === 'auto') return 'Auto-capture';
  if (value === 'manual') return 'Manual shutter';
  if (value === 'gallery') return 'Gallery';
  return '—';
}

export function matchesFieldTestCaptureTriggerFilter(
  reading: { captureTrigger?: string | null; imageSource?: string | null },
  filter: FieldTestCaptureTriggerFilter | string,
): boolean {
  const f = String(filter || 'all').trim().toLowerCase();
  if (!f || f === 'all') return true;
  return normalizeFieldTestCaptureTrigger(reading) === f;
}
