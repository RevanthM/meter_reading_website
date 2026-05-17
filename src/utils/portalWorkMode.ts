/** Stored on this device: portal role for navigation and save permissions. */
export type PortalWorkMode =
  | 'reviewer'
  | 'test_data_reviewer'
  | 'labeler'
  | 'admin';

/** @deprecated Use PortalWorkMode — kept for gradual rename. */
export type PortalRole = PortalWorkMode;

/** Passed from PortalLayout to child routes via `<Outlet context />`. */
export type PortalOutletWorkContext = {
  workMode: PortalWorkMode;
};

const STORAGE_KEY = 'meter_portal_role';
const LEGACY_STORAGE_KEY = 'meter_portal_work_mode';

export const PORTAL_ROLE_LABELS: Record<PortalWorkMode, string> = {
  reviewer: 'reviewer',
  test_data_reviewer: 'test data reviewer',
  labeler: 'labeler',
  admin: 'admin',
};

export function isPortalWorkMode(v: string): v is PortalWorkMode {
  return (
    v === 'reviewer' ||
    v === 'test_data_reviewer' ||
    v === 'labeler' ||
    v === 'admin'
  );
}

export function getStoredPortalWorkMode(): PortalWorkMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '';
    if (isPortalWorkMode(v)) return v;
    if (v === 'all') {
      const migrated = 'labeler';
      try {
        localStorage.setItem(STORAGE_KEY, migrated);
      } catch {
        /* ignore */
      }
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return 'reviewer';
}

export function setStoredPortalWorkMode(mode: PortalWorkMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Header value for metadata PATCH (admin uses reviewer permissions). */
export function portalWorkModeForMetadataHeader(mode: PortalWorkMode): string {
  if (mode === 'admin') return 'reviewer';
  return mode;
}
