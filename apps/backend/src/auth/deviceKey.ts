/**
 * Device identity for "one ACTIVE session per device". Precedence:
 *   1. `x-device-id` header — a stable id the client owns (Electron clientSessionId, mobile
 *      deviceRegistry uuid). Nothing is written back; the client re-sends it on every login/refresh.
 *   2. `xd` cookie — random uuid minted on the first login from a browser / mobile cookie jar,
 *      httpOnly, never cleared on logout.
 *   3. a fresh uuid (+ `xd` Set-Cookie unless `persist: false`, e.g. SDK / S2S without a jar).
 */
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { CookieInstruction, CookieSameSite } from './types';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_MS, DEVICE_ID_HEADER } from './constants';

export const DEVICE_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

export interface ResolvedDeviceKey {
  deviceKey: string;
  /** Set-Cookie to apply when the request carried no (valid) `xd` and no header. */
  cookie: CookieInstruction | null;
  source: 'header' | 'cookie' | 'minted';
}

/** The validated `x-device-id` header value, if any. */
export function deviceIdFromHeaders(req: Pick<Request, 'headers'>): string | undefined {
  const raw = req.headers[DEVICE_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && DEVICE_KEY_RE.test(value.trim()) ? value.trim() : undefined;
}

export function resolveDeviceKey(
  req: Pick<Request, 'cookies' | 'headers'>,
  opts: { sameSite: CookieSameSite; secure: boolean; persist?: boolean },
): ResolvedDeviceKey {
  const fromHeader = deviceIdFromHeaders(req);
  if (fromHeader) return { deviceKey: fromHeader, cookie: null, source: 'header' };

  const existing = req.cookies?.[DEVICE_COOKIE];
  if (typeof existing === 'string' && DEVICE_KEY_RE.test(existing)) {
    return { deviceKey: existing, cookie: null, source: 'cookie' };
  }
  const deviceKey = randomUUID();
  if (opts.persist === false) return { deviceKey, cookie: null, source: 'minted' };
  return {
    deviceKey,
    source: 'minted',
    cookie: {
      kind: 'set',
      name: DEVICE_COOKIE,
      value: deviceKey,
      options: {
        httpOnly: true,
        secure: opts.secure || opts.sameSite === 'none',
        sameSite: opts.sameSite,
        path: '/',
        maxAge: DEVICE_COOKIE_MAX_AGE_MS,
      },
    },
  };
}
