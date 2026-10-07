/**
 * The one decision path from request credentials to `req.user`, used by v1 `middleware/auth.ts`,
 * `authV2Middleware.ts`, the socket.io handshake, the Zero proxy, encryption routes,
 * call-invite routing and refresh-session.
 *
 *   1. `Authorization: Bearer <jwt>` (where allowed)   → verify statelessly (signature + `sid` tombstone)
 *   2. `xw_<ws>` access cookie for the claimed workspace → same; near expiry falls to 3 for a re-mint
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
  recordLegacyCredential,
  recordTokenMinted,
  routeGroupFromPath,
  type AuthResolveMiddleware,
} from '@/services/otel/authMetrics';
import {
  ACCESS_TOKEN_REFRESH_AHEAD_SECONDS,
  LAST_WORKSPACE_COOKIE,
  PLATFORM_HEADER,
  SESSION_COOKIE,
  WORKSPACE_HEADER,
  accessCookieName,
  legacyWsTokenCookieName,
} from './constants';
import { legacyCookieMirror, sameSiteFor } from './platform';
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
  OrgMemberRef,
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

/** A credential that arrived under a legacy name, or a legacy id under any name. */
function isLegacyCredential(cred: SessionCredentialValue): boolean {
  return cred.source !== 'xs' || isLegacyShaped(cred.value);
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export interface SessionResolverDeps {
  repo: SessionRepository;
  jwt: Pick<JwtService, 'verifyToken' | 'decodeToken'>;
  revocation: RevocationStore;
  now?: () => Date;
  /** TTL of the `xw_<ws>` access JWT (JWT_EXPIRATION_SECONDS). */
  jwtTtlSeconds?: number;
  secure?: boolean;
}

export interface SessionResolver {
  /** Credential → live session (no workspace). */
  resolveSession(input: Pick<ResolveInput, 'cookies' | 'headers'>): Promise<SessionOnlyResult>;
  /** Credential → session → workspace → `req.user`. */
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

export function createSessionResolver(deps: SessionResolverDeps): SessionResolver {
  const { repo, jwt, revocation } = deps;
  const clock = deps.now ?? (() => new Date());
  const jwtTtl = deps.jwtTtlSeconds ?? config.jwt.expirationSeconds;
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

  /** Verify a JWT. Session tokens resolve from claims alone; pre-deploy tokens (no `sid`) are checked against the DB. */
  async function verifyAccessToken(
    token: string,
    hint: string | undefined,
    path: AuthPath,
    input: Pick<ResolveInput, 'cookies' | 'headers'>,
  ): Promise<ResolveResult> {
    let payload: JwtPayload;
    try {
      payload = jwt.verifyToken(token);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      return failure(msg.toLowerCase().includes('expired') ? 'jwt_expired' : 'jwt_invalid');
    }
    if (hint && payload.workspaceId && hint !== payload.workspaceId) return failure('workspace_mismatch');

    if (isSessionJwt(payload)) {
      if (await revocation.isRevoked(payload.sid)) return failure('jwt_revoked');
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

    // Pre-deploy token: no sid, not tombstone-checkable; verify the user and account against the DB.
    const user = await repo.findUserById(payload.sub);
    if (!user) return failure('user_not_found');
    if (user.status !== 'ACTIVE' || user.leftAt) return failure('workspace_user_left');
    const effectiveWorkspace = payload.workspaceId ?? user.workspaceId;
    if (user.workspaceId !== effectiveWorkspace) return failure('workspace_mismatch');

    const memberId = payload.memberId || user.orgMemberId;
    if (!memberId) return failure('account_left');
    const orgMember = await repo.findOrgMember(memberId);
    if (!orgMember || orgMember.leftAt) return failure('account_left');

    // Bind to the session cookie travelling with it when it is the same account (mobile push register).
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

  function needsRefresh(existing: string, now: Date): boolean {
    const decoded = jwt.decodeToken(existing);
    if (!decoded?.exp) return true;
    return decoded.exp - Math.floor(now.getTime() / 1000) < ACCESS_TOKEN_REFRESH_AHEAD_SECONDS;
  }

  async function resolveFromSession(input: ResolveInput, hint: string | undefined, cred: SessionCredentialValue): Promise<ResolveResult> {
    const resolved = await resolveSession(input);
    if (!resolved.ok) return resolved;
    const { session, orgMember, path } = resolved.session;
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

    const base = { sameSite: sameSiteFor(platform), secure };
    const mirror = platform === 'MOBILE' && legacyCookieMirror(input);
    let cookies: CookieInstruction[];
    let legacyConversion: LegacyConversionInfo | null = null;
    if (isLegacyCredential(cred)) {
      cookies = cookiesForLegacyConversion({
        ...base,
        sessionToken: cred.value,
        sessionExpiresAt: session.absoluteExpiry,
        workspaceId: hint,
        jwt: minted,
        jwtTtlSeconds: jwtTtl,
        presentNames: Object.keys(input.cookies ?? {}),
        writeLastWorkspace: !cookieString(input.cookies, LAST_WORKSPACE_COOKIE),
        legacyMirror: mirror,
        now: clock(),
      });
      legacyConversion = {
        source: cred.source,
        rowCreated: path === 'session_converted',
        outcome: path === 'session_converted' ? 'row_converted' : 'cookies_migrated',
        legacyMirror: mirror,
      };
    } else {
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

  async function resolve(input: ResolveInput): Promise<ResolveResult> {
    const hint = input.workspaceId ?? headerString(input.headers, WORKSPACE_HEADER) ?? cookieString(input.cookies, LAST_WORKSPACE_COOKIE);
    const inlineRefresh = input.inlineRefresh !== false;
    const cred = readSessionCredential(input);

    // 1. Bearer JWT (SDK, mobile, claw, sockets).
    if (input.allowBearer) {
      const bearer = bearerFrom(input.headers);
      if (bearer) return verifyAccessToken(bearer, hint, 'jwt_bearer', input);
    }

    // 2. Access cookie for the claimed workspace.
    if (hint) {
      const access = cookieString(input.cookies, accessCookieName(hint));
      if (access) {
        const stale = inlineRefresh && !!cred && needsRefresh(access, clock());
        if (!stale) {
          const verified = await verifyAccessToken(access, hint, 'jwt_cookie', input);
          // A rejected cookie with a session credential behind it falls to the session path, which is
          // authoritative (a tombstoned sid becomes session_revoked; a stale signature is re-minted).
          if (verified.ok || !cred) return verified;
        }
      }
    }

    // 3. Session credential → row → membership → mint.
    if (cred) return resolveFromSession(input, hint, cred);

    // 4. Legacy per-workspace JWT cookie (old Electron / MCP readers): re-issued under xw_, never cleared.
    if (hint) {
      const legacyJwt = cookieString(input.cookies, legacyWsTokenCookieName(hint));
      if (legacyJwt) {
        const verified = await verifyAccessToken(legacyJwt, hint, 'jwt_cookie_legacy', input);
        if (!verified.ok || !verified.auth.sessionInfo || verified.auth.session) return verified;
        const platform = verified.auth.sessionInfo.platform;
        return {
          ok: true,
          auth: {
            ...verified.auth,
            cookies: inlineRefresh ? [accessTokenCookie(hint, legacyJwt, remainingTtlSeconds(legacyJwt, clock()), { sameSite: sameSiteFor(platform), secure })] : [],
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

  return { resolveSession, resolve };
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

/** Resolve an Express request and record `auth_resolve_total` / `auth_401_total` / legacy switch-overs. */
export async function resolveRequest(req: Request, opts: ResolveRequestOptions): Promise<ResolveResult> {
  const result = await getDefaultResolver().resolve({
    cookies: (req.cookies ?? {}) as Record<string, string | undefined>,
    headers: req.headers,
    allowBearer: opts.allowBearer,
    workspaceId: opts.workspaceId,
    inlineRefresh: opts.inlineRefresh !== false && req.inlineRefresh !== false,
  });
  if (result.ok) {
    recordAuthResolve({ path: result.auth.path, outcome: 'ok', middleware: opts.middleware });
    const conversion = result.auth.legacyConversion;
    if (conversion) {
      const info = result.auth.sessionInfo;
      // Stable event name: chart `auth_legacy_credential_total`, debug with this line.
      logger.info('[AUTH] legacy_session_converted', {
        event: 'legacy_session_converted',
        source: conversion.source,
        outcome: conversion.outcome,
        rowCreated: conversion.rowCreated,
        legacyMirror: conversion.legacyMirror,
        platform: info?.platform ?? 'unknown',
        orgId: info?.orgId,
        accountId: info?.accountId,
        sessionId: info?.sessionId,
        workspaceId: result.auth.workspaceId,
        middleware: opts.middleware,
        path: req.path,
      });
      recordLegacyCredential({
        source: conversion.source,
        platform: info?.platform ?? 'unknown',
        outcome: conversion.outcome,
        legacyMirror: conversion.legacyMirror,
      });
    }
  } else {
    recordAuthResolve({ path: 'none', outcome: 'fail', reason: result.reason, middleware: opts.middleware });
    if (result.status === 401) {
      recordAuth401({
        reason: result.reason,
        platform: headerString(req.headers, PLATFORM_HEADER) ?? 'web',
        routeGroup: routeGroupFromPath(req.originalUrl ?? req.url ?? ''),
      });
    }
    logger.debug('[AUTH] resolve failed', { reason: result.reason, middleware: opts.middleware, path: req.path });
  }
  return result;
}

/** Credential → live session, no workspace required (refresh-session, login reuse, logout). */
export function resolveSessionFromRequest(req: Request): Promise<SessionOnlyResult> {
  return getDefaultResolver().resolveSession({
    cookies: (req.cookies ?? {}) as Record<string, string | undefined>,
    headers: req.headers,
  });
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
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const hint = headerString(req.headers, WORKSPACE_HEADER) ?? cookieString(cookies, LAST_WORKSPACE_COOKIE);
  if (!hint) return !!cookieString(cookies, SESSION_COOKIE);
  return !!cookieString(cookies, accessCookieName(hint)) || !!cookieString(cookies, legacyWsTokenCookieName(hint));
}
