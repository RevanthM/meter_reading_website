import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import {
  formatCustomDateRangeLabel,
  formatPresetLabel,
  getDateRangeFromPreset,
  isDateRangePresetId,
  resolveCustomDateRangeWindow,
  type DateRangePresetId,
} from '../utils/dateRangePresets';

type DateRangeWindow = { from: string; to: string };

export function usePortalListDateRangeFilter(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  onApplied?: () => void,
) {
  const fromFilter = (searchParams.get('from') || '').trim();
  const toFilter = (searchParams.get('to') || '').trim();
  const rangePresetRaw = (searchParams.get('range') || '').trim();
  const rangePreset: DateRangePresetId | '' = isDateRangePresetId(rangePresetRaw) ? rangePresetRaw : '';

  const customDateWindow = useMemo(
    (): DateRangeWindow | null => resolveCustomDateRangeWindow(fromFilter, toFilter),
    [fromFilter, toFilter],
  );
  const presetWindow = rangePreset ? getDateRangeFromPreset(rangePreset) : null;
  const activeDateWindow = customDateWindow ?? presetWindow;

  const [dateFromDraft, setDateFromDraft] = useState(fromFilter);
  const [dateToDraft, setDateToDraft] = useState(toFilter);

  useEffect(() => {
    setDateFromDraft(fromFilter);
    setDateToDraft(toFilter);
  }, [fromFilter, toFilter]);

  const clearDateRangeFilters = useCallback(() => {
    setDateFromDraft('');
    setDateToDraft('');
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('date');
        n.delete('from');
        n.delete('to');
        n.delete('range');
        return n;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const applyRangePreset = useCallback(
    (preset: DateRangePresetId) => {
      setDateFromDraft('');
      setDateToDraft('');
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('date');
          n.delete('from');
          n.delete('to');
          n.set('range', preset);
          return n;
        },
        { replace: true },
      );
      onApplied?.();
    },
    [setSearchParams, onApplied],
  );

  const applyCustomDateRangeFromDraft = useCallback(() => {
    const from = dateFromDraft.trim();
    const to = dateToDraft.trim();

    if (!from && !to) {
      if (fromFilter || toFilter) {
        setSearchParams(
          (prev) => {
            const n = new URLSearchParams(prev);
            n.delete('from');
            n.delete('to');
            return n;
          },
          { replace: true },
        );
      }
      return;
    }

    const window = resolveCustomDateRangeWindow(from, to);
    if (!window) return;

    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('date');
        n.delete('range');
        n.set('from', window.from);
        n.set('to', window.to);
        return n;
      },
      { replace: true },
    );
  }, [dateFromDraft, dateToDraft, fromFilter, toFilter, setSearchParams]);

  const dateRangeLabel = useMemo(() => {
    if (customDateWindow) return formatCustomDateRangeLabel(customDateWindow);
    if (rangePreset) return formatPresetLabel(rangePreset);
    return '';
  }, [customDateWindow, rangePreset]);

  const hasDateFilter = Boolean(customDateWindow || rangePreset);

  return {
    rangePreset,
    customDateWindow,
    presetWindow,
    activeDateWindow,
    dateFromDraft,
    setDateFromDraft,
    dateToDraft,
    setDateToDraft,
    clearDateRangeFilters,
    applyRangePreset,
    applyCustomDateRangeFromDraft,
    dateRangeLabel,
    hasDateFilter,
  };
}
