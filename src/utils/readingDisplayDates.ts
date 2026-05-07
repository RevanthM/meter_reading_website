const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Short date for tables and detail: `MM/DD/YY` (no time). */
export function formatReadingShortDate(dateString: string): string {
  if (!dateString) return '—';
  const dayPart = dateString.split('T')[0] ?? '';
  if (ISO_DAY.test(dayPart)) {
    const parts = dayPart.split('-').map((x) => parseInt(x, 10));
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '—';
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y % 100).padStart(2, '0')}`;
  }
  const t = Date.parse(dateString);
  if (Number.isNaN(t)) return '—';
  const dt = new Date(t);
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const y = dt.getFullYear() % 100;
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y).padStart(2, '0')}`;
}
