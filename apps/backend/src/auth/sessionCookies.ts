/**
 * Pure cookie computation for login / refresh / logout. Nothing here touches `res`
 * except `applyCookies`, so the matrix (mode × legacy id × hint × looksLegacy) is unit-testable.
 */
import type { CookieOptions, Response } from 'express';
import type { AuthCookieMode, AuthPath, CookieInstruction, CookieSameSite } from './types';
import {
  LAST_WORKSPACE_COOKIE,
  LEGACY_SESSION_COOKIE,
  PENDING_AUTH_COOKIE,
  SESSION_COOKIE,
  isWsTokenCookieName,
  wsTokenCookieName,
} from './constants';

export interface CookieBaseInput {
  sameSite: CookieSameSite;
  secure: boolean;
}

export function cookieBase(input: CookieBaseInput): CookieOptions {
  return {
    httpOnly: true,
    // sameSite=none is rejected by browsers without Secure.
    secure: input.secure || input.sameSite === 'none',
    sameSite: input.sameSite,
    path: '/',
  };
}

function set(name: string, value: string, options: CookieOptions): CookieInstruction {
  return { kind: 'set', name, value, options };
}

function clear(name: string): CookieInstruction {
  return { kind: 'clear', name, options: { path: '/' } };
}

function msUntil(date: Date, now: Date): number {
  return Math.max(0, date.getTime() - now.getTime());
}

export function wsTokenCookie(
  workspaceId: string,
  jwt: string,
  jwtTtlSeconds: number,
  base: CookieBaseInput,
): CookieInstruction {
  return set(wsTokenCookieName(workspaceId), jwt, { ...cookieBase(base), maxAge: jwtTtlSeconds * 1000 });
}

/** The workspace hint. ONLY login / switch / create / join issuance may write it. */
export function lastWorkspaceCookie(
  workspaceId: string,
  sessionExpiresAt: Date,
  base: CookieBaseInput,
  now: Date = new Date(),
): CookieInstruction {
  return set(LAST_WORKSPACE_COOKIE, workspaceId, { ...cookieBase(base), maxAge: msUntil(sessionExpiresAt, now) });
}

export interface IssuanceCookiesInput extends CookieBaseInput {
  cookieMode: AuthCookieMode;
  /** `xs1_...` or null for legacy-only issuance. */
  sessionToken: string | null;
  /** Legacy `user_sessions` id to put in `user_session_id` (login row id; never rewritten on switch). */
  legacySessionId: string | null;
  workspaceId: string;
  jwt: string;
  jwtTtlSeconds: number;
  sessionExpiresAt: Date;
  /** Write `xyne_last_workspace` (login / switch / create / join: true). */
  setLastWorkspace: boolean;
  /** Request carried `X-Platform: electron|mobile`, `user_session_id` or `x-session-id`. */
  looksLegacy: boolean;
  /** Whether to (re)write `user_session_id`; switches keep the existing cookie untouched. */
  writeLegacyCookie?: boolean;
  now?: Date;
}

/**
 * Mode table:
 *   legacy  user_session_id + xyne_ws_<ws>_token (+ hint)
 *   dual    legacy set + xyne_session
 *   v3      xyne_session + xyne_ws_<ws>_token (+ hint); user_session_id only for legacy-looking clients
 * A null sessionToken always degrades to the legacy set (nothing else to hand out).
 */
export function cookiesForIssuance(input: IssuanceCookiesInput): CookieInstruction[] {
  const now = input.now ?? new Date();
  const base = { sameSite: input.sameSite, secure: input.secure };
  const out: CookieInstruction[] = [wsTokenCookie(input.workspaceId, input.jwt, input.jwtTtlSeconds, base)];
  if (input.setLastWorkspace) out.push(lastWorkspaceCookie(input.workspaceId, input.sessionExpiresAt, base, now));

  const sessionMaxAge = msUntil(input.sessionExpiresAt, now);
  const mode: AuthCookieMode = input.sessionToken ? input.cookieMode : 'legacy';
  const writeLegacy = input.writeLegacyCookie ?? true;

  const wantsLegacyCookie = mode === 'legacy' || mode === 'dual' || (mode === 'v3' && input.looksLegacy);
  if (wantsLegacyCookie && writeLegacy && input.legacySessionId) {
    out.push(set(LEGACY_SESSION_COOKIE, input.legacySessionId, { ...cookieBase(base), maxAge: sessionMaxAge }));
  }
  if ((mode === 'dual' || mode === 'v3') && input.sessionToken) {
    out.push(set(SESSION_COOKIE, input.sessionToken, { ...cookieBase(base), maxAge: sessionMaxAge }));
  }
  return out;
}

export interface RefreshCookiesInput extends CookieBaseInput {
  tokens: Array<{ workspaceId: string; jwt: string }>;
  jwtTtlSeconds: number;
  cookieMode: AuthCookieMode;
  /** How the session was found; legacy_* with a v3 session migrates the client to `xyne_session`. */
  path: AuthPath;
  sessionToken?: string | null;
  sessionExpiresAt?: Date;
  now?: Date;
}

/** Never writes the hint. */
export function cookiesForRefresh(input: RefreshCookiesInput): CookieInstruction[] {
  const base = { sameSite: input.sameSite, secure: input.secure };
  const out = input.tokens.map((t) => wsTokenCookie(t.workspaceId, t.jwt, input.jwtTtlSeconds, base));
  const migrate =
    input.path.startsWith('legacy_') && !!input.sessionToken && input.cookieMode !== 'legacy' && !!input.sessionExpiresAt;
  if (migrate) {
    out.push(
      set(SESSION_COOKIE, input.sessionToken as string, {
        ...cookieBase(base),
        maxAge: msUntil(input.sessionExpiresAt as Date, input.now ?? new Date()),
      }),
    );
  }
  return out;
}

/** Clears every auth cookie the request carried plus the fixed set. */
export function cookiesForLogout(presentNames: Iterable<string>): CookieInstruction[] {
  const names = new Set<string>([SESSION_COOKIE, LEGACY_SESSION_COOKIE, LAST_WORKSPACE_COOKIE, PENDING_AUTH_COOKIE]);
  for (const n of presentNames) if (isWsTokenCookieName(n)) names.add(n);
  return [...names].map(clear);
}

export function applyCookies(res: Response, list: CookieInstruction[]): void {
  for (const c of list) {
    if (c.kind === 'set') res.cookie(c.name, c.value, c.options);
    else res.clearCookie(c.name, c.options);
  }
}
