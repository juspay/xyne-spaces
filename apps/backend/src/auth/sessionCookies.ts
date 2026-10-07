/**
 * Pure cookie computation for login / refresh / legacy conversion / logout. Nothing here touches
 * `res` except `applyCookies`, so the matrix is unit-testable.
 *
 *   WEB / MOBILE / ELECTRON   xs (session) + xw_<ws> (access JWT) + xyne_last_workspace (+ xd)
 *   MOBILE under the version gate (legacyMirror)   the above + user_session_id + xyne_ws_<ws>_token
 *   SDK                       nothing (token travels in the poll body)
 */
import type { CookieOptions, Response } from 'express';
import type { CookieInstruction, CookieSameSite, SessionPlatform } from './types';
import {
  LAST_WORKSPACE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OLD_SESSION_COOKIE,
  PENDING_AUTH_COOKIE,
  SESSION_COOKIE,
  accessCookieName,
  isAccessCookieName,
  isLegacyWsTokenCookieName,
  legacyWsTokenCookieName,
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

/** `xw_<ws>` — the per-workspace access JWT. */
export function accessTokenCookie(workspaceId: string, jwt: string, jwtTtlSeconds: number, base: CookieBaseInput): CookieInstruction {
  return set(accessCookieName(workspaceId), jwt, { ...cookieBase(base), maxAge: jwtTtlSeconds * 1000 });
}

/** Legacy `xyne_ws_<ws>_token` carrying the same JWT; only for mobile builds under the version gate. */
export function legacyWsTokenCookie(workspaceId: string, jwt: string, jwtTtlSeconds: number, base: CookieBaseInput): CookieInstruction {
  return set(legacyWsTokenCookieName(workspaceId), jwt, { ...cookieBase(base), maxAge: jwtTtlSeconds * 1000 });
}

/** The workspace hint: login / switch / create / join issuance, or a legacy conversion that found none. */
export function lastWorkspaceCookie(
  workspaceId: string,
  sessionExpiresAt: Date,
  base: CookieBaseInput,
  now: Date = new Date(),
): CookieInstruction {
  return set(LAST_WORKSPACE_COOKIE, workspaceId, { ...cookieBase(base), maxAge: msUntil(sessionExpiresAt, now) });
}

function sessionCookies(sessionToken: string, sessionExpiresAt: Date, base: CookieBaseInput, legacyMirror: boolean, now: Date): CookieInstruction[] {
  const maxAge = msUntil(sessionExpiresAt, now);
  const out = [set(SESSION_COOKIE, sessionToken, { ...cookieBase(base), maxAge })];
  if (legacyMirror) out.push(set(LEGACY_SESSION_COOKIE, sessionToken, { ...cookieBase(base), maxAge }));
  return out;
}

function accessCookies(workspaceId: string, jwt: string, jwtTtlSeconds: number, base: CookieBaseInput, legacyMirror: boolean): CookieInstruction[] {
  const out = [accessTokenCookie(workspaceId, jwt, jwtTtlSeconds, base)];
  if (legacyMirror) out.push(legacyWsTokenCookie(workspaceId, jwt, jwtTtlSeconds, base));
  return out;
}

export interface SessionCookiesInput extends CookieBaseInput {
  platform: SessionPlatform;
  /** `xs1_...` opaque token (or the legacy id of a converted session). */
  sessionToken: string;
  sessionExpiresAt: Date;
  workspaceId: string;
  /** Access JWT for `workspaceId`. */
  jwt: string;
  jwtTtlSeconds: number;
  /** `xd` Set-Cookie from resolveDeviceKey, when the request carried none. */
  deviceCookie?: CookieInstruction | null;
  /** (Re)write `xs`; false on reuse (switch / create / join) to leave it untouched. */
  writeSessionCookies: boolean;
  /** Write `xyne_last_workspace` (login / switch / create / join: true). */
  writeLastWorkspace: boolean;
  /** Old mobile build: also write the legacy names (see platform.legacyCookieMirror). */
  legacyMirror?: boolean;
  now?: Date;
}

export function cookiesForSession(input: SessionCookiesInput): CookieInstruction[] {
  const now = input.now ?? new Date();
  const base = { sameSite: input.sameSite, secure: input.secure };
  const mirror = input.legacyMirror === true;
  const out: CookieInstruction[] = [];
  if (input.platform === 'SDK') return out;

  if (input.writeSessionCookies) out.push(...sessionCookies(input.sessionToken, input.sessionExpiresAt, base, mirror, now));
  if (input.deviceCookie) out.push(input.deviceCookie);
  if (input.writeLastWorkspace) out.push(lastWorkspaceCookie(input.workspaceId, input.sessionExpiresAt, base, now));
  out.push(...accessCookies(input.workspaceId, input.jwt, input.jwtTtlSeconds, base, mirror));
  return out;
}

export interface LegacyConversionCookiesInput extends CookieBaseInput {
  /** The credential value the client presented (legacy id, or an `xs1_` token under a legacy name). */
  sessionToken: string;
  sessionExpiresAt: Date;
  workspaceId: string;
  jwt: string;
  jwtTtlSeconds: number;
  /** Cookie names the request carried (for clearing every `xyne_ws_*`). */
  presentNames: Iterable<string>;
  /** True when the request carried no `xyne_last_workspace` (pure-legacy sessions never had one). */
  writeLastWorkspace: boolean;
  /** Old mobile build: keep the legacy names alive instead of clearing them. */
  legacyMirror?: boolean;
  now?: Date;
}

/**
 * A request that authenticated with legacy credentials moves to the new names on this response:
 * set `xs` + `xw_<ws>` (+ hint when missing); clear `user_session_id`, `xyne_session` and every
 * `xyne_ws_*` — unless the caller is an old mobile build, which gets both sets.
 */
export function cookiesForLegacyConversion(input: LegacyConversionCookiesInput): CookieInstruction[] {
  const now = input.now ?? new Date();
  const base = { sameSite: input.sameSite, secure: input.secure };
  const mirror = input.legacyMirror === true;
  const out: CookieInstruction[] = [];
  out.push(...sessionCookies(input.sessionToken, input.sessionExpiresAt, base, mirror, now));
  if (input.writeLastWorkspace) out.push(lastWorkspaceCookie(input.workspaceId, input.sessionExpiresAt, base, now));
  out.push(...accessCookies(input.workspaceId, input.jwt, input.jwtTtlSeconds, base, mirror));
  if (!mirror) {
    const names = new Set<string>([LEGACY_SESSION_COOKIE, OLD_SESSION_COOKIE]);
    for (const n of input.presentNames) if (isLegacyWsTokenCookieName(n)) names.add(n);
    out.push(...[...names].map(clear));
  }
  return out;
}

/** Clears every auth cookie the request carried plus the fixed set. Never clears `xd`. */
export function cookiesForLogout(presentNames: Iterable<string>): CookieInstruction[] {
  const names = new Set<string>([
    SESSION_COOKIE,
    LEGACY_SESSION_COOKIE,
    OLD_SESSION_COOKIE,
    LAST_WORKSPACE_COOKIE,
    PENDING_AUTH_COOKIE,
  ]);
  for (const n of presentNames) if (isAccessCookieName(n) || isLegacyWsTokenCookieName(n)) names.add(n);
  return [...names].map(clear);
}

export function applyCookies(res: Response, list: CookieInstruction[]): void {
  for (const c of list) {
    if (c.kind === 'set') res.cookie(c.name, c.value, c.options);
    else res.clearCookie(c.name, c.options);
  }
}
