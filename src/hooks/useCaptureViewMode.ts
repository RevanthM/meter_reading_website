import { useCallback, useState } from 'react';
import type { CaptureViewMode } from '../components/CaptureViewModeToggle';

export function useCaptureViewMode(
  storageKey: string,
  defaultMode: CaptureViewMode = 'list',
): [CaptureViewMode, (mode: CaptureViewMode) => void] {
  const [viewMode, setViewModeState] = useState<CaptureViewMode>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === 'map' ? 'map' : defaultMode;
    } catch {
      return defaultMode;
    }
  });

  const setViewMode = useCallback(
    (mode: CaptureViewMode) => {
      setViewModeState(mode);
      try {
        localStorage.setItem(storageKey, mode);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return [viewMode, setViewMode];
}
