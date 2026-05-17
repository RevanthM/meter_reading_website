/** `s_YYYYMMDD_HHMMSS_suffix` → `MM/DD/YY · suffix` (drops the HHMMSS segment). */
export function formatSessionIdForDisplay(id: string): string {
  const m = /^s_(\d{4})(\d{2})(\d{2})_\d{6}_(.+)$/.exec(id);
  if (!m) return id;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const suffix = m[4];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return id;
  return `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y % 100).padStart(2, '0')} · ${suffix}`;
}

export function formatImageDifficultyLabel(value: string | undefined | null): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
