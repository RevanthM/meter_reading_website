/** Calendar quick ranges in the viewer's local timezone (YYYY-MM-DD inclusive). */

export type DateRangePresetId = 'today' | 'yesterday' | 'last7' | 'last30';

export function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isDateRangePresetId(s: string): s is DateRangePresetId {
  return s === 'today' || s === 'yesterday' || s === 'last7' || s === 'last30';
}

/** Inclusive [from, to] using local calendar days. */
export function getDateRangeFromPreset(preset: DateRangePresetId): { from: string; to: string } {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayYmd = localYmd(startToday);

  if (preset === 'today') return { from: todayYmd, to: todayYmd };

  if (preset === 'yesterday') {
    const y = new Date(startToday);
    y.setDate(y.getDate() - 1);
    const ymd = localYmd(y);
    return { from: ymd, to: ymd };
  }

  if (preset === 'last7') {
    const from = new Date(startToday);
    from.setDate(from.getDate() - 6);
    return { from: localYmd(from), to: todayYmd };
  }

  const from = new Date(startToday);
  from.setDate(from.getDate() - 29);
  return { from: localYmd(from), to: todayYmd };
}

export function formatPresetLabel(preset: DateRangePresetId): string {
  switch (preset) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'last7':
      return 'Last 7 days';
    case 'last30':
      return 'Last 30 days';
    default:
      return preset;
  }
}
