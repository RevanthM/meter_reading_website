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
  labeler: 'model trainer',
  admin: 'admin',
};

/** Anica auth API role codes (Register + login profile `Role`). */
export const ANICA_API_ROLE_TO_PORTAL: Record<string, PortalWorkMode> = {
  rvwr: 'reviewer',
  trvr: 'test_data_reviewer',
  mtnr: 'labeler',
  admn: 'admin',
};

export const ANICA_API_ROLE_CODES = Object.keys(ANICA_API_ROLE_TO_PORTAL);

/** Placeholder role for self-registration until an admin assigns a portal role. */
export const ANICA_PENDING_REGISTER_ROLE = 'nusr';

export const PORTAL_TO_ANICA_API_ROLE: Record<PortalWorkMode, string> = {
  reviewer: 'rvwr',
  test_data_reviewer: 'trvr',
  labeler: 'mtnr',
  admin: 'admn',
};

export const ANICA_REGISTER_ROLE_OPTIONS: { portal: PortalWorkMode; label: string; apiRole: string }[] = (
  Object.keys(PORTAL_ROLE_LABELS) as PortalWorkMode[]
).map((portal) => ({
  portal,
  label: PORTAL_ROLE_LABELS[portal],
  apiRole: PORTAL_TO_ANICA_API_ROLE[portal],
}));

export function getAnicaApiRoleCode(profile: Record<string, unknown>): string | null {
  const raw = profile.Role ?? profile.role;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().toLowerCase();
}

export function isRecognizedAnicaApiRole(profile: Record<string, unknown>): boolean {
  const code = getAnicaApiRoleCode(profile);
  if (!code) return false;
  return code in ANICA_API_ROLE_TO_PORTAL;
}

export function isPendingAnicaApiRole(profile: Record<string, unknown>): boolean {
  const code = getAnicaApiRoleCode(profile);
  if (!code) return false;
  return code === ANICA_PENDING_REGISTER_ROLE;
}

export function hasAssignedAnicaPortalRole(profile: Record<string, unknown>): boolean {
  return isRecognizedAnicaApiRole(profile) && !isPendingAnicaApiRole(profile);
}

export function portalWorkModeFromAnicaRole(profile: Record<string, unknown>): PortalWorkMode | null {
  const code = getAnicaApiRoleCode(profile);
  if (!code) return null;
  return ANICA_API_ROLE_TO_PORTAL[code] ?? null;
}

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
