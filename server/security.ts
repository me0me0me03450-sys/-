import crypto from 'node:crypto';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = process.env.NIDAA_SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

export function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '');
}

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain.trim(), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(plain: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(plain.trim(), salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateSecurePin(): string {
  return String(crypto.randomInt(1000, 10000));
}

export interface StaffTokenPayload {
  sub: string;
  username: string;
  fullName: string;
  role: 'super_admin' | 'queue_monitor';
  sectionId: string | null;
  exp: number;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, 'utf8').toString('base64url');
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

export function signStaffToken(
  payload: Omit<StaffTokenPayload, 'exp'>,
  ttlSeconds = 12 * 60 * 60
): string {
  const fullPayload: StaffTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyStaffToken(token: string): StaffTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const parsed = JSON.parse(base64UrlDecode(body)) as StaffTokenPayload;
    if (
      !parsed ||
      typeof parsed.sub !== 'string' ||
      typeof parsed.username !== 'string' ||
      (parsed.role !== 'super_admin' && parsed.role !== 'queue_monitor') ||
      !parsed.exp ||
      parsed.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signParentTrackingToken(callId: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`parent-call:${callId}`)
    .digest('base64url');
}

export function verifyParentTrackingToken(
  callId: string,
  token: string
): boolean {
  if (!callId || !token) return false;
  const expected = signParentTrackingToken(callId);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signParentRegistrationToken(regId: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`parent-reg:${regId}`)
    .digest('base64url');
}

export function verifyParentRegistrationToken(
  regId: string,
  token: string
): boolean {
  if (!regId || !token) return false;
  const expected = signParentRegistrationToken(regId);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
