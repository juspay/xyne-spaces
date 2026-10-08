/**
 * The one decision path from request credentials to `req.user`, used by v1 `middleware/auth.ts`,
 * `authV2Middleware.ts`, the socket.io handshake, the Zero proxy, encryption routes,
 * call-invite routing and refresh-session.
 *
 *   1. `Authorization: Bearer <jwt>` (where allowed)   → verify statelessly (signature + `sid`
 *      tombstone + claims watermark)
 *   2. `xw_<ws>` access cookie for the claimed workspace → same; near expiry, stale or rejected
 *      falls to 3 for a re-mint
 *   3. session credential (`xs`, or a legacy name)      → auth_sessions by sha256 (legacy
 *      `workflow.user_sessions` row converted on first read), membership check, mint `xw_<ws>`,
 *      Set-Cookie (plus the legacy → new cookie switch-over when a legacy name carried it)
 *   4. legacy `xyne_ws_<ws>_token` cookie               → as 2, re-issued under `xw_<ws>`
 *
 * The workspace claim is `x-workspace-id`, fallback `xyne_last_workspace`.
 */
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'http';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { isSessionJwt, jwtService, type JwtPayload, type JwtService, type SessionJwtClaims } from '@/services/jwtService';
import type { AuthenticatedUser } from '@/types/express';
import { authSessionRepository } from '@/bypassAcl/authSessionServices';
import {
  recordAuth401,
  recordAuthResolve,
  recordClaimsStale,
  recordLegacyCredential,
  recordTokenMinted,
  routeGroupFromPath,
  type AuthResolveMiddleware,
} from '@/services/otel/authMetrics';
import {
  LAST_WORKSPACE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OLD_SESSION_COOKIE,
  PLATFORM_HEADER,
  SESSION_COOKIE,
  WORKSPACE_HEADER,
  accessCookieName,
  isLegacyWsTokenCookieName,
  legacyWsTokenCookieName,
} from './constants';
import { legacyCookieMirror, responsePlatform, sameSiteFor } from './platform';
import { redisRevocationStore } from './revocation';
import { accessTokenCookie, applyCookies, cookiesForLegacyConversion } from './sessionCookies';
import { mintWorkspaceJwt, secureCookies } from './sessionIssuer';
import { hashToken, isLegacyShaped, readSessionCredential, type SessionCredentialValue } from './sessionTokens';
import type {
  AuthPath,
  AuthSessionInfo,
  AuthSessionRow,
  CookieInstruction,
  LegacyConversionInfo,
  MembershipUser,
  ResolveFailure,
  ResolveFailureReason,
  ResolveInput,
  ResolveResult,
  ResolvedAuth,
  RevocationStore,
  SessionOnly,
  SessionOnlyResult,
  SessionPlatform,
  SessionRepository,
} from './types';

// ─── Failure table (bounded set of reasons → status + body) ─────────────────

const NO_SESSION_BODY = { error: 'No session found', message: 'Session ID cookie is missing' } as const;
const LOGIN_AGAIN = 'Please log in again';

const FAILURES: Record<ResolveFailureReason, { status: 401 | 403; body: ResolveFailure['body'] }> = {
  no_credentials: { status: 401, body: NO_SESSION_BODY },
  session_not_found: { status: 401, body: NO_SESSION_BODY },
  session_expired: { status: 401, body: { error: 'Session expired', message: LOGIN_AGAIN, code: 'SESSION_EXPIRED' } },
  session_revoked: { status: 401, body: { error: 'Session revoked', message: LOGIN_AGAIN, code: 'SESSION_REVOKED' } },
  account_left: { status: 401, body: { error: 'User removed from organization', message: 'You have been removed from this organization' } },
  workspace_user_left: { status: 401, body: { error: 'User removed from workspace', message: 'You have been removed from this workspace' } },
  workspace_forbidden: {
    status: 403,
    body: { error: 'Workspace forbidden', message: 'You do not have access to this workspace', code: 'WORKSPACE_FORBIDDEN' },
  },
  workspace_hint_missing: {
    status: 401,
    body: { error: 'Workspace context missing', message: 'Unable to determine workspace for this session. Please log in again.' },
  },
  workspace_mismatch: {
    status: 401,
    body: { error: 'Workspace mismatch', message: 'Token does not match the requested workspace', code: 'WORKSPACE_MISMATCH' },
  },
  user_not_found: { status: 401, body: { error: 'User not found', message: 'User not found' } },
  jwt_expired: { status: 401, body: { error: 'Token expired', message: LOGIN_AGAIN, code: 'TOKEN_EXPIRED' } },
  jwt_invalid: { status: 401, body: { error: 'Invalid token', message: 'Invalid or malformed token' } },
  jwt_revoked: { status: 401, body: { error: 'Session revoked', message: LOGIN_AGAIN, code: 'SESSION_REVOKED' } },
  /**
   * INTERNAL signal, never sent to a client: the token is valid and its session is live, but the
   * role / membership it froze has changed. It is only produced for callers that CAN be re-minted
   * on this same response, and `resolve` always swallows it by falling through to the session path.
   * Callers that cannot be re-minted get their claims re-read from the DB instead
   * (`resolveStaleClaims`), so no client needs a `TOKEN_STALE` implementation.
   */
  jwt_stale: { status: 401, body: { error: 'Token stale', message: 'Please refresh your session', code: 'TOKEN_STALE' } },
};

export function failure(reason: ResolveFailureReason): ResolveFailure {
  const f = FAILURES[reason];
  return { ok: false, reason, status: f.status, body: f.body };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headerString(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

function cookieString(cookies: Record<string, unknown> | undefined, name: string): string | undefined {
  const v = cookies?.[name];
  return typeof v === 'string' && v ? v : undefined;
}

function bearerFrom(headers: IncomingHttpHeaders): string | undefined {
  const h = headerString(headers, 'authorization');
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m?.[1]?.trim();
  return token && token !== 'null' && token !== 'undefined' ? token : undefined;
}

function toAuthenticatedUser(user: MembershipUser, workspaceId: string, memberId: string, orgRole: string): AuthenticatedUser {
  return {
    id: user.id,
    googleId: user.providerUserId,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    workspaceId,
    isApiKeyUser: false,
    scopes: [],
    role: user.role,
    orgRole,
    memberId,
    authProvider: user.authProvider,
  };
}

/** `req.user` from session JWT claims: no DB read. `googleId` / `authProvider` are not carried; `/auth/me` reads them. */
function userFromClaims(claims: SessionJwtClaims): AuthenticatedUser {
  return {
    id: claims.sub,
    googleId: '',
    email: claims.email,
    name: claims.name,
    displayName: undefined,
    workspaceId: claims.workspaceId,
    isApiKeyUser: false,
    scopes: [],
    role: claims.role,
    orgRole: claims.orgRole,
    memberId: claims.memberId,
    authProvider: undefined,
  };
}

function sessionInfoFromRow(session: AuthSessionRow): AuthSessionInfo {
  return {
    sessionId: session.id,
    accountId: session.accountId,
    orgId: session.orgId,
    platform: session.platform as SessionPlatform,
    absoluteExpiry: session.absoluteExpiry,
  };
}

function isLive(session: AuthSessionRow, now: Date): 'ok' | 'session_revoked' | 'session_expired' {
  if (session.status !== 'ACTIVE') return 'session_revoked';
  if (session.absoluteExpiry.getTime() <= now.getTime()) return 'session_expired';
  return 'ok';
}

/** Any legacy cookie name still in the jar (so the switch-over response can clear it). */
function legacyNamesPresent(cookies: Record<string, unknown> | undefined): boolean {
  for (const name of Object.keys(cookies ?? {})) {
    if (name === LEGACY_SESSION_COOKIE || name === OLD_SESSION_COOKIE || isLegacyWsTokenCookieName(name)) return true;
  }
  return false;
}

/**
 * Does this response have to move the client onto the new cookie names?
 *
 * True when the credential arrived under a legacy NAME, or when legacy names are still sitting in
 * the jar alongside `xs`. Deliberately NOT keyed on the credential's SHAPE: a converted session
 * keeps the old `user_sessions.id` as its `xs` value (so the encryption fingerprint survives the
 * conversion), and testing the shape made every later request look like a fresh conversion —
 * re-emitting the switch-over cookies and inflating `auth_legacy_credential_total` forever.
 */
function needsCookieSwitchOver(cred: SessionCredentialValue, cookies: Record<string, unknown> | undefined): boolean {
  return cred.source !== 'xs' || legacyNamesPresent(cookies);
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export interface SessionResolverDeps {
  repo: SessionRepository;
  jwt: Pick<JwtService, 'verifyToken' | 'decodeToken'>;
  revocation: RevocationStore;
  now?: () => Date;
  /** TTL of the `xw_<ws>` access JWT (JWT_EXPIRATION_SECONDS). */
  jwtTtlSeconds?: number;
  /** Re-mint when the access JWT has less than this left (config.jwt.refreshAheadSeconds). */
  refreshAheadSeconds?: number;
  secure?: boolean;
}

export interface SessionResolver {
  /** Credential → live session (no workspace). */
  resolveSession(input: Pick<ResolveInput, 'cookies' | 'headers'>): Promise<SessionOnlyResult>;
  /**
   * Live session + claimed workspace → `req.user` + the cookies to set. The step shared by the
   * middleware's inline refresh and `GET /auth/refresh-session`, so both mint, switch cookies over
   * and report the switch-over identically.
   */
  grantWorkspace(input: GrantWorkspaceInput): Promise<ResolveResult>;
  /** Credential → session → workspace → `req.user`. */
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

export interface GrantWorkspaceInput {
  resolved: SessionOnly;
  /** Target workspace; `workspace_hint_missing` when absent. */
  workspaceId: string | undefined;
  cookies: Record<string, string | undefined>;
  headers: IncomingHttpHeaders;
  /** False for callers that cannot deliver Set-Cookie (socket handshake): mint, write nothing. */
  writeCookies?: boolean;
}

export function createSessionResolver(deps: SessionResolverDeps): SessionResolver {
  const { repo, jwt, revocation } = deps;
  const clock = deps.now ?? (() => new Date());
  const jwtTtl = deps.jwtTtlSeconds ?? config.jwt.expirationSeconds;
  const refreshAhead = deps.refreshAheadSeconds ?? config.jwt.refreshAheadSeconds;
  const secure = deps.secure ?? secureCookies();

  async function resolveSession(input: Pick<ResolveInput, 'cookies' | 'headers'>): Promise<SessionOnlyResult> {
    const cred = readSessionCredential(input);
    if (!cred) return failure('no_credentials');
    const now = clock();
    const tokenHash = hashToken(cred.value);

    let session = await repo.findByTokenHash(tokenHash);
    let path: SessionOnly['path'] = 'session';
    if (!session && isLegacyShaped(cred.value)) {
      const legacy = await repo.findLegacyRowForConversion(cred.value);
      const usable =
        legacy &&
        legacy.status === 'ACTIVE' &&
        legacy.refreshTokenExpiry.getTime() > now.getTime() &&
        legacy.user.orgMemberId &&
        legacy.user.orgMember &&
        !legacy.user.orgMember.leftAt;
      if (!usable) return failure('session_not_found');
      session = await repo.convertLegacySession({ legacy, tokenHash });
      path = 'session_converted';
    }
    if (!session) return failure('session_not_found');

    const live = isLive(session, now);
    if (live !== 'ok') return failure(live);

    const orgMember = await repo.findOrgMember(session.accountId);
    if (!orgMember || orgMember.leftAt) {
      await repo.revokeSession(session.id, 'ACCOUNT_LEFT');
      return failure('account_left');
    }
    return { ok: true, session: { session, orgMember, credential: cred.value, source: cred.source, path } };
  }

  /**
   * The authorization a stale token froze, re-read from the DB.
   *
   * This is what `main` did on EVERY request (role, org role and `leftAt` were always live), so a
   * role change used to heal itself. It now happens only while the account's claims watermark is
   * newer than the token — bounded by one JWT TTL after a role change — and only for callers that
   * have nothing to re-mint from: Bearer clients (claw, MCP, the Electron agent proxy, mobile) and
   * the socket handshake. Rejecting them instead would have required a refresh implementation in
   * every one of those clients, and none of them has one.
   */
  async function resolveStaleClaims(
    payload: JwtPayload & SessionJwtClaims,
    token: string,
    path: AuthPath,
  ): Promise<ResolveResult> {
    const orgMember = await repo.findOrgMember(payload.memberId);
    if (!orgMember || orgMember.leftAt) return failure('account_left');
    // ACTIVE + leftAt null is part of this lookup, so a removed or deactivated member is caught here too.
    const membership = await repo.findMembership(payload.memberId, payload.workspaceId);
    if (!membership) return failure('workspace_forbidden');
    recordClaimsStale({ surface: 'resolver', outcome: 'db_verified' });
    return {
      ok: true,
      auth: {
        user: toAuthenticatedUser(membership, payload.workspaceId, orgMember.memberId, orgMember.role),
        membership,
        orgMember,
        workspaceId: payload.workspaceId,
        session: null,
        // `sid` and `platform` describe the session and are unaffected by a role write; `orgId`
        // comes from the row in case the member moved org.
        sessionInfo: { sessionId: payload.sid, accountId: orgMember.memberId, orgId: orgMember.orgId, platform: payload.platform },
        path,
        cookies: [],
        accessToken: token,
        legacyConversion: null,
      },
    };
  }

  /**
   * A session JWT resolves from its claims alone: no DB read, one Redis round trip for the two
   * things the signature cannot cover — the session's tombstone and the account's claims watermark.
   *
   * `canRefresh` says whether the caller can be handed a fresh token on this same response. When it
   * can, a stale token short-circuits to the session path (which re-mints, so later requests are
   * stateless again); when it cannot, the claims are re-read from the DB and the request proceeds.
   * Either way a stale token never surfaces as an error to a client.
   */
  async function resolveSessionJwt(
    payload: JwtPayload & SessionJwtClaims,
    token: string,
    path: AuthPath,
    canRefresh: boolean,
  ): Promise<ResolveResult> {
    const verdict = await revocation.checkClaims({ sid: payload.sid, accountId: payload.memberId, iat: payload.iat });
    if (verdict === 'revoked') return failure('jwt_revoked');
    if (verdict === 'stale') {
      if (!canRefresh) return resolveStaleClaims(payload, token, path);
      recordClaimsStale({ surface: 'resolver', outcome: 'refreshed' });
      return failure('jwt_stale');
    }
    return {
      ok: true,
      auth: {
        user: userFromClaims(payload),
        membership: null,
        orgMember: { memberId: payload.memberId, orgId: payload.orgId, role: payload.orgRole, leftAt: null },
        workspaceId: payload.workspaceId,
        session: null,
        sessionInfo: { sessionId: payload.sid, accountId: payload.memberId, orgId: payload.orgId, platform: payload.platform },
        path,
        cookies: [],
        accessToken: token,
        legacyConversion: null,
      },
    };
  }

  /**
   * A JWT minted before this deploy: no `sid`, so neither tombstone nor watermark applies to it.
   * The user and the account are verified against the DB instead, and the session cookie travelling
   * with it is adopted when it belongs to the same account (mobile push register needs a session).
   */
  async function resolveLegacyJwt(
    payload: JwtPayload,
    token: string,
    path: AuthPath,
    input: Pick<ResolveInput, 'cookies' | 'headers'>,
  ): Promise<ResolveResult> {
    const user = await repo.findUserById(payload.sub);
    if (!user) return failure('user_not_found');
    if (user.status !== 'ACTIVE' || user.leftAt) return failure('workspace_user_left');
    const effectiveWorkspace = payload.workspaceId ?? user.workspaceId;
    if (user.workspaceId !== effectiveWorkspace) return failure('workspace_mismatch');

    const memberId = payload.memberId || user.orgMemberId;
    if (!memberId) return failure('account_left');
    const orgMember = await repo.findOrgMember(memberId);
    if (!orgMember || orgMember.leftAt) return failure('account_left');

    let session: AuthSessionRow | null = null;
    const viaCookie = await resolveSession(input);
    if (viaCookie.ok && viaCookie.session.session.accountId === orgMember.memberId) session = viaCookie.session.session;

    return {
      ok: true,
      auth: {
        user: toAuthenticatedUser(user, effectiveWorkspace, orgMember.memberId, orgMember.role),
        membership: user,
        orgMember,
        workspaceId: effectiveWorkspace,
        session,
        sessionInfo: session ? sessionInfoFromRow(session) : null,
        path: path === 'jwt_bearer' ? 'jwt_legacy' : path,
        cookies: [],
        accessToken: token,
        legacyConversion: null,
      },
    };
  }

  /** Signature + workspace claim, then the stateless or the pre-deploy path. */
  async function verifyAccessToken(
    token: string,
    hint: string | undefined,
    path: AuthPath,
    input: Pick<ResolveInput, 'cookies' | 'headers'>,
    canRefresh = false,
  ): Promise<ResolveResult> {
    let payload: JwtPayload;
    try {
      payload = jwt.verifyToken(token);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      return failure(msg.toLowerCase().includes('expired') ? 'jwt_expired' : 'jwt_invalid');
    }
    if (hint && payload.workspaceId && hint !== payload.workspaceId) return failure('workspace_mismatch');
    return isSessionJwt(payload)
      ? resolveSessionJwt(payload, token, path, canRefresh)
      : resolveLegacyJwt(payload, token, path, input);
  }

  function needsRefresh(existing: string, now: Date): boolean {
    const decoded = jwt.decodeToken(existing);
    if (!decoded?.exp) return true;
    return decoded.exp - Math.floor(now.getTime() / 1000) < refreshAhead;
  }

  async function grantWorkspace(input: GrantWorkspaceInput): Promise<ResolveResult> {
    const { session, orgMember, credential, source, path } = input.resolved;
    const hint = input.workspaceId;
    if (!hint) return failure('workspace_hint_missing');
    const membership = await repo.findMembership(session.accountId, hint);
    if (!membership) return failure('workspace_forbidden');

    const platform = session.platform as SessionPlatform;
    const minted = mintWorkspaceJwt({
      user: membership,
      memberId: orgMember.memberId,
      workspaceId: hint,
      sid: session.id,
      orgId: orgMember.orgId,
      orgRole: orgMember.role,
      platform,
    });
    recordTokenMinted({ audience: 'cookie' });

    // Cookie shaping follows the REQUEST, not the row: a legacy row whose user agent merely said
    // "Mobile" must not get SameSite=None cookies on a browser request (see responsePlatform).
    const base = { sameSite: sameSiteFor(responsePlatform({ headers: input.headers }, platform)), secure };
    const mirror = platform === 'MOBILE' && legacyCookieMirror({ headers: input.headers });
    const switchOver = needsCookieSwitchOver({ value: credential, source }, input.cookies);
    const writeCookies = input.writeCookies !== false;
    let cookies: CookieInstruction[] = [];
    let legacyConversion: LegacyConversionInfo | null = null;
    if (switchOver) {
      if (writeCookies) {
        cookies = cookiesForLegacyConversion({
          ...base,
          sessionToken: credential,
          sessionExpiresAt: session.absoluteExpiry,
          workspaceId: hint,
          jwt: minted,
          jwtTtlSeconds: jwtTtl,
          presentNames: Object.keys(input.cookies ?? {}),
          writeLastWorkspace: !cookieString(input.cookies, LAST_WORKSPACE_COOKIE),
          legacyMirror: mirror,
          now: clock(),
        });
      }
      // Only report a switch-over that actually happened: a caller that cannot deliver Set-Cookie
      // (socket handshake) changed nothing, and counting it would inflate the conversion metric on
      // every reconnect. The row conversion itself is still reported, since that did happen.
      if (writeCookies || path === 'session_converted') {
        legacyConversion = {
          source,
          rowCreated: path === 'session_converted',
          outcome: path === 'session_converted' ? 'row_converted' : 'cookies_migrated',
          legacyMirror: mirror,
        };
      }
    } else if (writeCookies) {
      cookies = [accessTokenCookie(hint, minted, jwtTtl, base)];
    }

    return {
      ok: true,
      auth: {
        user: toAuthenticatedUser(membership, hint, orgMember.memberId, orgMember.role),
        membership,
        orgMember,
        workspaceId: hint,
        session,
        sessionInfo: sessionInfoFromRow(session),
        path,
        cookies,
        accessToken: minted,
        legacyConversion,
      },
    };
  }

  async function resolveFromSession(input: ResolveInput, hint: string | undefined, writeCookies: boolean): Promise<ResolveResult> {
    const resolved = await resolveSession(input);
    if (!resolved.ok) return resolved;
    return grantWorkspace({
      resolved: resolved.session,
      workspaceId: hint,
      cookies: input.cookies,
      headers: input.headers,
      writeCookies,
    });
  }

  async function resolve(input: ResolveInput): Promise<ResolveResult> {
    const hint = input.workspaceId ?? headerString(input.headers, WORKSPACE_HEADER) ?? cookieString(input.cookies, LAST_WORKSPACE_COOKIE);
    const inlineRefresh = input.inlineRefresh !== false;
    const cred = readSessionCredential(input);

    // 1. Bearer JWT (SDK, mobile, claw, sockets). `canRefresh: false` — a Bearer client cannot be
    // handed a cookie, and re-minting from an accompanying `xs` would not help (it would keep
    // presenting the same token). A stale Bearer is resolved against the DB instead, which is what
    // every request did before this model existed.
    if (input.allowBearer) {
      const bearer = bearerFrom(input.headers);
      if (bearer) return verifyAccessToken(bearer, hint, 'jwt_bearer', input, false);
    }

    // 2. Access cookie for the claimed workspace.
    if (hint) {
      const access = cookieString(input.cookies, accessCookieName(hint));
      if (access) {
        const stale = inlineRefresh && !!cred && needsRefresh(access, clock());
        if (!stale) {
          const verified = await verifyAccessToken(access, hint, 'jwt_cookie', input, inlineRefresh && !!cred);
          // A rejected cookie with a session credential behind it falls to the session path, which is
          // authoritative (a tombstoned sid becomes session_revoked; a stale or expired signature is
          // re-minted with the current role).
          if (verified.ok || !cred) return verified;
        }
      }
    }

    // 3. Session credential → row → membership → mint.
    if (cred) return resolveFromSession(input, hint, inlineRefresh);

    // 4. Legacy per-workspace JWT cookie (old Electron / MCP readers): re-issued under xw_, never cleared.
    if (hint) {
      const legacyJwt = cookieString(input.cookies, legacyWsTokenCookieName(hint));
      if (legacyJwt) {
        const verified = await verifyAccessToken(legacyJwt, hint, 'jwt_cookie_legacy', input, false);
        if (!verified.ok || !verified.auth.sessionInfo || verified.auth.session) return verified;
        const platform = verified.auth.sessionInfo.platform;
        return {
          ok: true,
          auth: {
            ...verified.auth,
            cookies: inlineRefresh
              ? [accessTokenCookie(hint, legacyJwt, remainingTtlSeconds(legacyJwt, clock()), { sameSite: sameSiteFor(responsePlatform({ headers: input.headers }, platform)), secure })]
              : [],
            legacyConversion: { source: 'xyne_ws_cookie', rowCreated: false, outcome: 'jwt_reissued', legacyMirror: false },
          },
        };
      }
    }

    return failure('no_credentials');
  }

  function remainingTtlSeconds(token: string, now: Date): number {
    const decoded = jwt.decodeToken(token);
    if (!decoded?.exp) return jwtTtl;
    return Math.max(1, decoded.exp - Math.floor(now.getTime() / 1000));
  }

  return { resolveSession, grantWorkspace, resolve };
}

// ─── Default instance + request helpers ───────────────────────────────────────

let defaultResolver: SessionResolver | null = null;
function getDefaultResolver(): SessionResolver {
  if (!defaultResolver) {
    defaultResolver = createSessionResolver({ repo: authSessionRepository, jwt: jwtService, revocation: redisRevocationStore });
  }
  return defaultResolver;
}

/** Test seam. */
export function setDefaultSessionResolver(resolver: SessionResolver | null): void {
  defaultResolver = resolver;
}

export interface ResolveRequestOptions {
  allowBearer: boolean;
  workspaceId?: string;
  middleware: AuthResolveMiddleware;
  /** Default true; `req.inlineRefresh === false` also disables it (socket handshake). */
  inlineRefresh?: boolean;
}

function requestCookies(req: Request): Record<string, string | undefined> {
  return (req.cookies ?? {}) as Record<string, string | undefined>;
}

/** The workspace this request claims: explicit > `x-workspace-id` > `xyne_last_workspace`. */
export function workspaceHintFromRequest(req: Request, explicit?: string): string | undefined {
  return explicit ?? headerString(req.headers, WORKSPACE_HEADER) ?? cookieString(requestCookies(req), LAST_WORKSPACE_COOKIE);
}

/**
 * `auth_resolve_total` / `auth_401_total`, plus the legacy switch-over log + counter. Shared by the
 * middlewares and refresh-session so one query counts every conversion regardless of which path
 * performed it.
 */
function recordResolved(req: Request, result: ResolveResult, middleware: AuthResolveMiddleware): void {
  if (result.ok) {
    recordAuthResolve({ path: result.auth.path, outcome: 'ok', middleware });
    const conversion = result.auth.legacyConversion;
    if (!conversion) return;
    const info = result.auth.sessionInfo;
    const platform = info?.platform ?? 'unknown';
    const fields = {
      event: 'legacy_session_converted',
      source: conversion.source,
      outcome: conversion.outcome,
      rowCreated: conversion.rowCreated,
      legacyMirror: conversion.legacyMirror,
      platform,
      orgId: info?.orgId,
      accountId: info?.accountId,
      sessionId: info?.sessionId,
      workspaceId: result.auth.workspaceId,
      middleware,
      path: req.path,
    };
    // Stable event name: chart `auth_legacy_credential_total`, debug with this line. A mirrored old
    // mobile build keeps its legacy names on purpose and so reports on EVERY request — debug level
    // there, info for the one-off switch-overs that actually change the client's cookies.
    if (conversion.legacyMirror && !conversion.rowCreated) logger.debug('[AUTH] legacy_session_converted', fields);
    else logger.info('[AUTH] legacy_session_converted', fields);
    recordLegacyCredential({
      source: conversion.source,
      platform,
      outcome: conversion.outcome,
      legacyMirror: conversion.legacyMirror,
    });
    return;
  }
  recordAuthResolve({ path: 'none', outcome: 'fail', reason: result.reason, middleware });
  if (result.status === 401) {
    recordAuth401({
      reason: result.reason,
      platform: headerString(req.headers, PLATFORM_HEADER) ?? 'web',
      routeGroup: routeGroupFromPath(req.originalUrl ?? req.url ?? ''),
    });
  }
  logger.debug('[AUTH] resolve failed', { reason: result.reason, middleware, path: req.path });
}

/** Resolve an Express request and record `auth_resolve_total` / `auth_401_total` / legacy switch-overs. */
export async function resolveRequest(req: Request, opts: ResolveRequestOptions): Promise<ResolveResult> {
  const result = await getDefaultResolver().resolve({
    cookies: requestCookies(req),
    headers: req.headers,
    allowBearer: opts.allowBearer,
    workspaceId: opts.workspaceId,
    inlineRefresh: opts.inlineRefresh !== false && req.inlineRefresh !== false,
  });
  recordResolved(req, result, opts.middleware);
  return result;
}

/** Credential → live session, no workspace required (refresh-session, login reuse, logout). */
export function resolveSessionFromRequest(req: Request): Promise<SessionOnlyResult> {
  return getDefaultResolver().resolveSession({
    cookies: requestCookies(req),
    headers: req.headers,
  });
}

/**
 * Already-resolved session + this request's claimed workspace → mint + cookies, with the same
 * metrics and switch-over log the middleware emits. `GET /auth/refresh-session` is the one caller:
 * it owns the session lookup and the device-key adoption, and shares everything else from here.
 */
export async function grantWorkspaceForRequest(
  req: Request,
  resolved: SessionOnly,
  opts: { workspaceId?: string; middleware: AuthResolveMiddleware },
): Promise<ResolveResult> {
  const result = await getDefaultResolver().grantWorkspace({
    resolved,
    workspaceId: workspaceHintFromRequest(req, opts.workspaceId),
    cookies: requestCookies(req),
    headers: req.headers,
  });
  recordResolved(req, result, opts.middleware);
  return result;
}

/** Attach the outcome to the request: `req.user`, `req.authSession`, `req.authenticatedSessionId`, `req.accessToken`. */
export function applyResolvedAuth(req: Request, auth: ResolvedAuth): void {
  req.user = auth.user;
  req.authSession = auth.sessionInfo ?? undefined;
  req.authenticatedSessionId = auth.sessionInfo?.sessionId;
  req.accessToken = auth.accessToken ?? undefined;
}

/**
 * `applyResolvedAuth` + the response cookies (inline refresh / legacy switch-over), mirrored into
 * `req.cookies` so downstream handlers on this same request see the fresh values.
 */
export function attachResolvedAuth(req: Request, res: Response, auth: ResolvedAuth): void {
  applyResolvedAuth(req, auth);
  if (auth.cookies.length === 0) return;
  applyCookies(res, auth.cookies);
  if (!req.cookies) req.cookies = {};
  for (const c of auth.cookies) {
    if (c.kind === 'set') req.cookies[c.name] = c.value;
    else delete req.cookies[c.name];
  }
}

/** True when the request carries anything the resolver could authenticate (for optional-auth routes). */
export function hasAuthCredential(req: Request): boolean {
  if (bearerFrom(req.headers)) return true;
  if (readSessionCredential(req)) return true;
  const cookies = requestCookies(req);
  const hint = headerString(req.headers, WORKSPACE_HEADER) ?? cookieString(cookies, LAST_WORKSPACE_COOKIE);
  if (!hint) return !!cookieString(cookies, SESSION_COOKIE);
  return !!cookieString(cookies, accessCookieName(hint)) || !!cookieString(cookies, legacyWsTokenCookieName(hint));
}
