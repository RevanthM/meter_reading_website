/** Backend auth API (sign-in, device OTP, registration). */

const DEFAULT_BASE = 'https://chatanicaappep2.azurewebsites.net';

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

export function persistAnicaLoginSession(user: AnicaLoginSessionUser): void {
  try {
    sessionStorage.setItem(ANICA_LOGIN_SESSION_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function loadAnicaLoginSession(): AnicaLoginSessionUser | null {
  try {
    const raw = sessionStorage.getItem(ANICA_LOGIN_SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as unknown;
    if (u && typeof u === 'object' && !Array.isArray(u)) return u as AnicaLoginSessionUser;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearAnicaLoginSession(): void {
  try {
    sessionStorage.removeItem(ANICA_LOGIN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** SendOTP `appl` query value. */
export function getAnicaLoginAppl(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_APPL as string) || 'AMR';
}

/** SendOTP `role` query value. */
export function getAnicaLoginRole(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_ROLE as string) || 'AMR';
}

/** ValidateOTP `APP` query value. */
export function getAnicaLoginAppForOtp(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_APP_OTP as string) || 'AMR';
}

/** Default `Role` in POST /Register JSON body. */
export function getAnicaLoginDefaultRegisterRole(): string {
  return (import.meta.env.VITE_ANICA_LOGIN_REGISTER_ROLE as string) || 'AMR';
}
