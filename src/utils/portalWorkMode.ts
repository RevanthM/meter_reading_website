/** Stored on this device: reviewer (review / move queues), labeler (pipelines + export), or admin (iteration registry + broader tools). */
export type PortalWorkMode = 'reviewer' | 'labeler' | 'admin';

/** Passed from PortalLayout to child routes via `<Outlet context />`. */
export type PortalOutletWorkContext = {
  workMode: PortalWorkMode;
};

const STORAGE_KEY = 'meter_portal_work_mode';

export function getStoredPortalWorkMode(): PortalWorkMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'reviewer' || v === 'labeler' || v === 'admin') return v;
    /** Legacy third mode — map to labeler (pipelines + lists). */
    if (v === 'all') {
      try {
        localStorage.setItem(STORAGE_KEY, 'labeler');
      } catch {
        /* ignore */
      }
      return 'labeler';
    }
  } catch {
    /* ignore */
  }
  return 'reviewer';
}

export function setStoredPortalWorkMode(mode: PortalWorkMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
