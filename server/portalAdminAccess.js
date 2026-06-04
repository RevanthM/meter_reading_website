/** Portal admin gate — matches client `saireetika*` bypass accounts. */
export const PORTAL_ADMIN_BYPASS_PREFIX = 'saireetika';

export function isPortalAdminBypassIdentity(value) {
  const v = String(value || '').trim().toLowerCase();
  return v.length > 0 && v.startsWith(PORTAL_ADMIN_BYPASS_PREFIX);
}

/** @param {import('express').Request} req */
export function getPortalRequestIdentity(req) {
  return [
    req.headers['x-user-email'],
    req.headers['x-anica-user-id'],
    req.headers['x-user-id'],
  ];
}

/**
 * @param {import('express').Request} req
 */
export function isAdminPortalRequest(req) {
  const mode = String(req.headers['x-portal-work-mode'] || '').trim().toLowerCase();
  if (mode === 'admin') return true;
  for (const raw of getPortalRequestIdentity(req)) {
    if (isPortalAdminBypassIdentity(raw)) return true;
  }
  return false;
}
