/** Normalized capture_trigger values from iOS metadata (`auto` | `manual` | `gallery`). */

export const FIELD_TEST_CAPTURE_TRIGGER_VALUES = ['auto', 'manual', 'gallery'];

export const FIELD_TEST_CAPTURE_TRIGGER_FILTER_OPTIONS = [
  { id: 'all', label: 'All capture types' },
  { id: 'auto', label: 'Auto-capture' },
  { id: 'manual', label: 'Manual shutter' },
  { id: 'gallery', label: 'Gallery' },
];

export function normalizeFieldTestCaptureTrigger(item) {
  const raw = String(item?.captureTrigger ?? item?.capture_trigger ?? '')
    .trim()
    .toLowerCase();
  if (FIELD_TEST_CAPTURE_TRIGGER_VALUES.includes(raw)) return raw;
  const src = String(item?.imageSource ?? item?.image_source ?? '')
    .trim()
    .toLowerCase();
  if (src === 'gallery') return 'gallery';
  return '';
}

export function fieldTestCaptureTriggerLabel(value) {
  const v = normalizeFieldTestCaptureTrigger({ capture_trigger: value });
  if (v === 'auto') return 'Auto-capture';
  if (v === 'manual') return 'Manual shutter';
  if (v === 'gallery') return 'Gallery';
  return '—';
}

export function matchesFieldTestCaptureTriggerFilter(item, filterValue) {
  const f = String(filterValue || 'all').trim().toLowerCase();
  if (!f || f === 'all') return true;
  return normalizeFieldTestCaptureTrigger(item) === f;
}
