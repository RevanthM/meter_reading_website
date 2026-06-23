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

/** Suffix-only session id for dense list rows; full id goes in `title`. */
export function formatSessionIdListSubline(id: string): string {
  const m = /^s_(\d{4})(\d{2})(\d{2})_\d{6}_(.+)$/.exec(id);
  if (m) {
    const suffix = m[4];
    return suffix.length > 22 ? `${suffix.slice(0, 19)}…` : suffix;
  }
  return id.length > 14 ? `${id.slice(0, 11)}…` : id;
}

/** `YYYYMMDD_HHMMSS` from session ids (field: `1000_f_20260529_073418_…`, legacy: `s_YYYYMMDD_HHMMSS_…`). */
export function formatSessionIdTimestampForList(id: string): string {
  const field = /^(\d+)_f_(\d{8})_(\d{6})_/i.exec(id);
  if (field) return `${field[2]}_${field[3]}`;

  const legacy = /^s_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/i.exec(id);
  if (legacy) return `${legacy[1]}${legacy[2]}${legacy[3]}_${legacy[4]}${legacy[5]}${legacy[6]}`;

  const anywhere = /(\d{8})_(\d{6})/.exec(id);
  if (anywhere) return `${anywhere[1]}_${anywhere[2]}`;

  return id.length > 18 ? `${id.slice(0, 15)}…` : id;
}

export function formatImageDifficultyLabel(value: string | undefined | null): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
