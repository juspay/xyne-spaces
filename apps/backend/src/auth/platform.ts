import type { Request } from 'express';
import { config } from '@/config/env';
import type { CookieSameSite, MobileOs, RequestPlatform, SessionPlatform } from './types';
import { APP_PLATFORM_HEADER, APP_VERSION_HEADER, PLATFORM_HEADER } from './constants';

type HeaderSource = { headers: Request['headers'] };

function header(req: HeaderSource, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s.toLowerCase() : undefined;
}

/** `x-platform` header (electron | mobile | native→mobile) > handler hint > web. */
export function platformFromRequest(req: HeaderSource, hint?: RequestPlatform): RequestPlatform {
  const h = header(req, PLATFORM_HEADER);
  if (h === 'electron') return 'electron';
  if (h === 'mobile' || h === 'native') return 'mobile';
  return hint ?? 'web';
}

export function toSessionPlatform(p: RequestPlatform | 'sdk'): SessionPlatform {
  switch (p) {
    case 'electron':
      return 'ELECTRON';
    case 'mobile':
      return 'MOBILE';
    case 'sdk':
      return 'SDK';
    default:
      return 'WEB';
  }
}

export function fromSessionPlatform(p: SessionPlatform | string): RequestPlatform {
  switch (p) {
    case 'ELECTRON':
      return 'electron';
    case 'MOBILE':
      return 'mobile';
    default:
      return 'web';
  }
}

/** Default SameSite for cookies written outside an OAuth redirect: mobile jar needs none. */
export function sameSiteFor(platform: SessionPlatform | string, flow: 'oauth_web' | 'default' = 'default'): CookieSameSite {
  if (platform === 'MOBILE') return 'none';
  if (flow === 'oauth_web') return 'lax';
  return 'strict';
}

// ─── Mobile legacy-cookie gate ───────────────────────────────────────────────

/**
 * Mobile OS of the caller: the `x-app-platform` header (new builds), else the user agent
 * (React Native fetch: Android = okhttp, iOS = CFNetwork/Darwin). Unknown when neither says.
 */
export function mobileOsFromRequest(req: HeaderSource): MobileOs {
  const explicit = header(req, APP_PLATFORM_HEADER);
  if (explicit === 'ios' || explicit === 'android') return explicit;
  const ua = header(req, 'user-agent') ?? '';
  if (/okhttp|android|dalvik/.test(ua)) return 'android';
  if (/cfnetwork|darwin|iphone|ipad|ios/.test(ua)) return 'ios';
  return 'unknown';
}

/**
 * Numeric compare of dotted version strings (`2.1.1` vs `2.10`). Missing segments count as 0;
 * non-numeric segments are compared by their leading digits (`3-beta` → 3). Returns -1 / 0 / 1.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): number[] =>
    v
      .trim()
      .split('.')
      .map((seg) => {
        const n = parseInt(seg, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Old mobile builds read `user_session_id` + `xyne_ws_<ws>_token` from their cookie jar and never
 * `xs` / `xw_`. Until the new app is the floor, a MOBILE request whose `x-app-version` is below the
 * configured per-OS threshold (`MOBILE_LEGACY_COOKIES_BELOW_IOS` / `_ANDROID`) also receives the
 * legacy names, and a legacy conversion does not clear them. Unknown OS or missing version while a
 * threshold is configured → mirror (the safe side is extra cookies, not a lockout). No threshold → never.
 */
export function legacyCookieMirror(req: HeaderSource): boolean {
  if (platformFromRequest(req) !== 'mobile') return false;
  const thresholds = config.session.mobileLegacyCookiesBelow;
  const os = mobileOsFromRequest(req);
  const threshold = os === 'ios' ? thresholds.ios : os === 'android' ? thresholds.android : thresholds.ios || thresholds.android;
  if (!threshold) return false;
  const version = header(req, APP_VERSION_HEADER);
  if (!version) return true;
  return compareVersions(version, threshold) < 0;
}
