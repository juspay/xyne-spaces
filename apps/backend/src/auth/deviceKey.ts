/**
 * Device identity for "one ACTIVE session per device". Precedence:
 *   1. `x-device-id` header — a stable id the client owns (Electron clientSessionId, mobile
 *      deviceRegistry uuid). Nothing is written back; the client re-sends it on every login/refresh.
 *   2. `xd` cookie — random uuid minted on the first login from a browser / mobile cookie jar,
 *      httpOnly, never cleared on logout.
 *   3. a fresh uuid, written back as `xd`.
 *
 * Sessions that belong to no browser (SDK approval, S2S) never come through here — they mint their
 * own random key, so the approver's device is not treated as the client's (see `issueSession`).
 */
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { CookieInstruction, CookieSameSite } from './types';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_MS, DEVICE_ID_HEADER, S2S_DEVICE_KEY_PREFIX } from './constants';

export const DEVICE_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * A device key a CLIENT is allowed to claim. Shape, plus the reserved `s2s:` namespace: that
 * prefix names the per-account row server-to-server tokens are pinned to, and "one ACTIVE session
 * per device" means anyone who could present `x-device-id: s2s:<someAccountId>` would revoke that
 * account's background-token row — a cross-account denial of service on agents and scheduled jobs.
 */
export function isClientDeviceKey(value: string): boolean {
  return DEVICE_KEY_RE.test(value) && !value.startsWith(S2S_DEVICE_KEY_PREFIX);
}

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
  return typeof value === 'string' && isClientDeviceKey(value.trim()) ? value.trim() : undefined;
}

export function resolveDeviceKey(
  req: Pick<Request, 'cookies' | 'headers'>,
  opts: { sameSite: CookieSameSite; secure: boolean },
): ResolvedDeviceKey {
  const fromHeader = deviceIdFromHeaders(req);
  if (fromHeader) return { deviceKey: fromHeader, cookie: null, source: 'header' };

  const existing = req.cookies?.[DEVICE_COOKIE];
  if (typeof existing === 'string' && isClientDeviceKey(existing)) {
    return { deviceKey: existing, cookie: null, source: 'cookie' };
  }
  const deviceKey = randomUUID();
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
