/** Backend auth API (sign-in, device OTP, registration). */

import {
  getStoredPortalWorkMode,
  portalWorkModeFromAnicaRole,
  setStoredPortalWorkMode,
  type PortalWorkMode,
} from '../utils/portalWorkMode';

const DEFAULT_BASE = 'https://chatanicaappep2.azurewebsites.net';

/** Dev / QA accounts that may switch roles and skip activation checks. */
const PORTAL_ROLE_BYPASS_USER_ID_PREFIX = 'saireetika';

export const ANICA_ACCOUNT_INACTIVE_MESSAGE =
  'Your account is not active yet. Please contact your administrator to activate your account before signing in.';

export const ANICA_ACCOUNT_UNKNOWN_ROLE_MESSAGE =
  'Your account role is not recognized for this portal. Please contact your administrator.';

export function getAnicaLoginAuthBaseUrl(): string {
  if (import.meta.env.VITE_ANICA_LOGIN_AUTH_USE_PROXY === 'true') {
    return '/anica-login-api';
  }
  const fromEnv = import.meta.env.VITE_ANICA_LOGIN_AUTH_BASE_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.replace(/\/$/, '');
  return DEFAULT_BASE;
}

export const ANICA_LOGIN_DEVICE_ID_KEY = 'anica_login_device_id';
export const ANICA_LOGIN_CLIENT_FINGERPRINT_KEY = 'anica_login_client_fingerprint';
export const ANICA_LOGIN_SESSION_KEY = 'anica_login_session';
export const ANICA_LOGIN_USER_ID_KEY = 'anica_login_user_id';

export interface AnicaLoginApiEnvelope {
  type: 'S' | 'E' | string;
  code?: string;
  message?: string;
  entityJson?: string;
  errorMessages?: string[];
}

export function getOrCreateClientFingerprint(): string {
  try {
    let fp = localStorage.getItem(ANICA_LOGIN_CLIENT_FINGERPRINT_KEY);
    if (!fp) {
      fp = `web_${crypto.randomUUID().replace(/-/g, '')}`;
      localStorage.setItem(ANICA_LOGIN_CLIENT_FINGERPRINT_KEY, fp);
    }
    return fp;
  } catch {
    return `web_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

export function getStoredDeviceId(): string | null {
  try {
    return localStorage.getItem(ANICA_LOGIN_DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredDeviceId(deviceId: string): void {
  try {
    localStorage.setItem(ANICA_LOGIN_DEVICE_ID_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

export function clearAnicaLoginDeviceId(): void {
  try {
    localStorage.removeItem(ANICA_LOGIN_DEVICE_ID_KEY);
  } catch {
    /* ignore */
  }
}

export function isAnicaLoginSuccess(env: AnicaLoginApiEnvelope): boolean {
  return env.type === 'S' || env.code === '0';
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function postForm(path: string, params: Record<string, string>): Promise<AnicaLoginApiEnvelope> {
  const url = `${getAnicaLoginAuthBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
  });
  const data = (await res.json()) as AnicaLoginApiEnvelope;
  return data;
}

export async function anicaLogin(userId: string, password: string, deviceId: string): Promise<AnicaLoginApiEnvelope> {
  return postForm('/Login', {
    UserID: userId,
    Password: password,
    DeviceID: deviceId,
  });
}

export async function anicaSendOtp(userId: string, appl: string, role: string): Promise<AnicaLoginApiEnvelope> {
  return postForm('/SendOTP', {
    UserID: userId,
    appl,
    role,
  });
}

export async function anicaValidateOtp(userId: string, otp: string, app: string): Promise<AnicaLoginApiEnvelope> {
  return postForm('/ValidateOTP', {
    UserID: userId,
    OTP: otp,
    APP: app,
  });
}

export async function anicaRegister(body: {
  UserID: string;
  FirstName: string;
  LastName: string;
  EMailID: string;
  PhoneNum: string;
  password: string;
  appl: string;
  Role: string;
}): Promise<AnicaLoginApiEnvelope> {
  const url = `${getAnicaLoginAuthBaseUrl()}/Register`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as AnicaLoginApiEnvelope;
}

export async function anicaUpdatePassword(userId: string, otp: string, newPassword: string): Promise<AnicaLoginApiEnvelope> {
  return postForm('/UpdatePassword', {
    UserID: userId,
    OTP: otp,
    NewPassword: newPassword,
  });
}

/** Parse entityJson from login success; may be a JSON object string or empty. */
export function parseEntityJson(entityJson: string | undefined): Record<string, unknown> | null {
  if (!entityJson || !entityJson.trim()) return null;
  try {
    const parsed = JSON.parse(entityJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export function envelopeErrorMessage(env: AnicaLoginApiEnvelope): string {
  if (env.errorMessages?.length) return env.errorMessages.join(' ');
  return env.message || 'Request failed';
}

export function assertSuccess(env: AnicaLoginApiEnvelope): void {
  if (!isAnicaLoginSuccess(env)) {
    throw new Error(envelopeErrorMessage(env));
  }
}

/** ValidateOTP returns device id as JSON string or plain string in entityJson. */
export function parseDeviceIdFromEntity(entityJson: string | undefined): string | null {
  if (!entityJson?.trim()) return null;
  const t = entityJson.trim();
  try {
    const p = JSON.parse(t) as unknown;
    if (typeof p === 'string' && p.length > 0) return p;
  } catch {
    const unquoted = t.replace(/^"+|"+$/g, '');
    return unquoted.length > 0 ? unquoted : null;
  }
  return null;
}

export type AnicaLoginSessionUser = Record<string, unknown>;

export function getAnicaUserId(profile: AnicaLoginSessionUser): string | null {
  const uid = profile.UserID ?? profile.userId ?? profile.userID;
  if (typeof uid === 'string' && uid.trim()) return uid.trim();
  return null;
}

/** Ensure login profile includes UserID from the sign-in form (API entityJson often omits it). */
export function enrichAnicaLoginProfile(
  profile: AnicaLoginSessionUser,
  loginUserId?: string | null,
): AnicaLoginSessionUser {
  const fromLogin = loginUserId?.trim();
  if (!fromLogin || getAnicaUserId(profile)) return profile;
  return { ...profile, UserID: fromLogin };
}

function matchesPortalRoleBypassPrefix(userId: string | null | undefined): boolean {
  if (!userId?.trim()) return false;
  return userId.trim().toLowerCase().startsWith(PORTAL_ROLE_BYPASS_USER_ID_PREFIX);
}

/** User IDs starting with `saireetika` may bypass activation and use all portal roles. */
export function isAnicaPortalRoleBypassUser(
  profile: AnicaLoginSessionUser,
  loginUserId?: string | null,
): boolean {
  const uid = getAnicaUserId(profile) ?? loginUserId?.trim() ?? null;
  return matchesPortalRoleBypassPrefix(uid);
}

/** Admin API role (`admn`) and dev bypass accounts may switch portal roles in the sidebar. */
export function canSwitchPortalRolesFromProfile(profile: AnicaLoginSessionUser): boolean {
  if (isAnicaPortalRoleBypassUser(profile)) return true;
  return portalWorkModeFromAnicaRole(profile) === 'admin';
}

export function persistAnicaLoginSession(user: AnicaLoginSessionUser): void {
  try {
    sessionStorage.setItem(ANICA_LOGIN_SESSION_KEY, JSON.stringify(user));
    const uid = getAnicaUserId(user);
    if (uid) localStorage.setItem(ANICA_LOGIN_USER_ID_KEY, uid);
  } catch {
    /* ignore */
  }
}

export function loadAnicaLoginSession(): AnicaLoginSessionUser | null {
  try {
    const raw = sessionStorage.getItem(ANICA_LOGIN_SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as unknown;
    if (u && typeof u === 'object' && !Array.isArray(u)) {
      const profile = u as AnicaLoginSessionUser;
      if (getAnicaUserId(profile)) return profile;
      let storedUserId: string | null = null;
      try {
        storedUserId = localStorage.getItem(ANICA_LOGIN_USER_ID_KEY);
      } catch {
        /* ignore */
      }
      return enrichAnicaLoginProfile(profile, storedUserId);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearAnicaLoginSession(): void {
  try {
    sessionStorage.removeItem(ANICA_LOGIN_SESSION_KEY);
    localStorage.removeItem(ANICA_LOGIN_USER_ID_KEY);
  } catch {
    /* ignore */
  }
}

/** SendOTP `appl` query value. */
export function getAnicaLoginAppl(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_APPL as string) || 'AM';
}

/** SendOTP `role` query value (portal-wide default when user role is unknown). */
export function getAnicaLoginRole(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_ROLE as string) || 'rvwr';
}

/** ValidateOTP `APP` query value. */
export function getAnicaLoginAppForOtp(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_APP_OTP as string) || 'AM';
}

/** Default `Role` in POST /Register JSON body. */
export function getAnicaLoginDefaultRegisterRole(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_REGISTER_ROLE as string) || 'rvwr';
}

export function isAnicaUserAccountActive(profile: AnicaLoginSessionUser): boolean {
  const isActive = profile.IsActive ?? profile.isActive;
  if (isActive === null || isActive === undefined) return false;
  if (typeof isActive === 'boolean') return isActive;
  if (typeof isActive === 'string') {
    const t = isActive.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes') return true;
    if (t === 'false' || t === '0' || t === 'no' || t === '') return false;
  }
  return Boolean(isActive);
}

/** Validates profile before creating a portal session; throws with a user-facing message. */
export function assertAnicaUserCanSignIn(
  profile: AnicaLoginSessionUser,
  loginUserId?: string | null,
): PortalWorkMode {
  const enriched = enrichAnicaLoginProfile(profile, loginUserId);
  const bypass = isAnicaPortalRoleBypassUser(enriched, loginUserId);
  const canSwitchRoles = canSwitchPortalRolesFromProfile(enriched);
  if (!bypass && !isAnicaUserAccountActive(enriched)) {
    throw new Error(ANICA_ACCOUNT_INACTIVE_MESSAGE);
  }
  const mode = portalWorkModeFromAnicaRole(enriched);
  if (mode) {
    setStoredPortalWorkMode(mode);
    return canSwitchRoles ? getStoredPortalWorkMode() : mode;
  }
  if (canSwitchRoles) {
    return getStoredPortalWorkMode();
  }
  throw new Error(ANICA_ACCOUNT_UNKNOWN_ROLE_MESSAGE);
}
