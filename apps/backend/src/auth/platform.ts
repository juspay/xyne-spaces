import type { Request } from 'express';
import type { RequestPlatform, SessionPlatform } from './types';
import { LEGACY_SESSION_COOKIE, LEGACY_SESSION_HEADER, PLATFORM_HEADER } from './constants';

type HeaderSource = { headers: Request['headers']; cookies?: Record<string, unknown> | undefined };

function header(req: HeaderSource, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s.toLowerCase() : undefined;
}

/** `x-platform` header (electron|mobile) > handler hint > web. */
export function platformFromRequest(req: HeaderSource, hint?: RequestPlatform): RequestPlatform {
  const h = header(req, PLATFORM_HEADER);
  if (h === 'electron' || h === 'mobile') return h;
  return hint ?? 'web';
}

/**
 * Requests that must keep receiving `user_session_id` in AUTH_COOKIE_MODE=v3: Electron and the
 * mobile shell say so with `X-Platform`; anything already carrying the legacy id (claw-forged
 * cookies, MCP, old dashboards on the header) is legacy by evidence.
 */
export function looksLegacyClient(req: HeaderSource): boolean {
  const h = header(req, PLATFORM_HEADER);
  if (h === 'electron' || h === 'mobile') return true;
  if (typeof req.cookies?.[LEGACY_SESSION_COOKIE] === 'string' && req.cookies[LEGACY_SESSION_COOKIE]) return true;
  return !!header(req, LEGACY_SESSION_HEADER);
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
