/**
 * The one request-authentication decision shared by v1 `middleware/auth.ts`, v2
 * `authV2Middleware.ts`, `refresh-session` and public-route helpers.
 *
 * Order (see plan "Resolver order"):
 *   0. hint = explicit workspaceId ?? x-workspace-id ?? xyne_last_workspace
 *   1. JWT fast path (Bearer if allowed, else xyne_ws_<hint>_token); Redis tombstone on `sid`
 *      when READ_MODE != legacy; today's user / orgMember / leftAt checks; no session row read.
 *   2. Session path (allowAutoRefresh only):
 *      a. READ != legacy: xyne_session / x-session-token → auth session (miss ⇒ continue)
 *      b. legacy id (user_session_id / x-session-id / legacy-shaped xyne_session) → mapped auth session
 *      c. READ != v3: raw legacy row
 *      d. nothing ⇒ 401
 *   3. auth session ⇒ grant for hint (lazy-minted on active membership) or default/primary grant,
 *      mint JWT, refresh cookies (never the hint), throttled touch.
 *   4. refresh-endpoint with no hint ⇒ session + primary grant's user, no token (controller mints per grant).
 *
 * `createSessionResolver` takes every dependency so the decision table is unit-testable without a DB.
 */
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'http';
import type { SessionWorkspaceGrant } from '@prisma/client';
import { config } from '@/config/env';
import { jwtService, type JwtPayload, type JwtService } from '@/services/jwtService';
import { logger as baseLogger } from '@/utils/logger';
import type { AuthenticatedUser } from '@/types/express';
import { authSessionRepository } from '@/bypassAcl/authSessionServices';
import { shouldTouch } from './authSessionService';
import {
  LAST_WORKSPACE_COOKIE,
  LEGACY_SESSION_COOKIE,
  LEGACY_SESSION_HEADER,
  SESSION_COOKIE,
  SESSION_TOKEN_HEADER,
  WORKSPACE_HEADER,
  wsTokenCookieName,
} from './constants';
import { getAuthSessionFlags } from './flags';
import { redisRevocationStore } from './revocation';
import { applyCookies, cookiesForRefresh } from './sessionCookies';
import { SESSION_TOKEN_PREFIX, parseSessionToken } from './sessionTokens';
import type {
  AuthPath,
  AuthSessionFlags,
  AuthSessionWithGrants,
  AuthSessionInfo,
  CookieInstruction,
  LegacySessionWithUser,
  MembershipUser,
  ResolveFailure,
  ResolveFailureReason,
  ResolveInput,
  ResolveResult,
  ResolvedAuth,
  RevocationStore,
  SessionPlatform,
  SessionRepository,
} from './types';

const logger = baseLogger.child({ module: 'SessionResolver' });

/** `ACTIVE` without importing @xyne/shared (keeps this module jest-light). */
const ACTIVE = 'ACTIVE';

export interface SessionResolverDeps {
  jwt: Pick<JwtService, 'verifyToken' | 'generateToken'>;
  repo: SessionRepository;
  revocation: RevocationStore;
  flags: AuthSessionFlags;
  now?: () => Date;
  jwtTtlSeconds: number;
  sessionExpiryDays: number;
  secureCookies: boolean;
}

/** `ResolveInput` plus the v1 refresh-ahead knob (resolver-local; not part of the shared contract). */
export type ResolverInput = ResolveInput & {
  /** JWT expiring within this many seconds is refreshed through the session path when possible. */
  refreshAheadSeconds?: number;
};

export interface SessionResolver {
  resolve(input: ResolverInput): Promise<ResolveResult>;
}

type Cookies = Record<string, string | undefined>;

const NO_SESSION_BODY = { error: 'No session found', message: 'Session ID cookie is missing' } as const;
const BODIES: Record<ResolveFailureReason, ResolveFailure['body']> = {
  no_credentials: NO_SESSION_BODY,
  session_not_found: NO_SESSION_BODY,
  session_expired: NO_SESSION_BODY,
  session_revoked: NO_SESSION_BODY,
  user_not_found: NO_SESSION_BODY,
  jwt_expired: NO_SESSION_BODY,
  jwt_invalid: NO_SESSION_BODY,
  jwt_revoked: NO_SESSION_BODY,
  account_left: { error: 'User removed from organization', message: 'You have been removed from this organization' },
  workspace_user_left: { error: 'User removed from workspace', message: 'You have been removed from this workspace' },
  workspace_context_missing: {
    error: 'Workspace context missing',
    message: 'Unable to determine workspace for this session. Please log in again.',
  },
  workspace_hint_missing: {
    error: 'Workspace context missing',
    message: 'Unable to determine workspace for this session. Please log in again.',
  },
  workspace_forbidden: {
    error: 'Workspace forbidden',
    message: 'You do not have access to this workspace',
    code: 'WORKSPACE_FORBIDDEN',
  },
};

export function failure(reason: ResolveFailureReason): ResolveFailure {
  return { ok: false, reason, status: reason === 'workspace_forbidden' ? 403 : 401, body: BODIES[reason] };
}

function cookieString(cookies: Cookies, name: string): string | undefined {
  const v = cookies[name];
  return typeof v === 'string' && v ? v : undefined;
}

function headerString(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

function tokenPreview(token: string): string {
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function isGrantActive(grant: SessionWorkspaceGrant, now: Date): boolean {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
}

/** The login grant (legacySessionId === session.legacySessionId), else the oldest active one. */
export function primaryGrant(session: AuthSessionWithGrants, now: Date): SessionWorkspaceGrant | null {
  const active = session.grants.filter((g) => isGrantActive(g, now));
  if (!active.length) return null;
  const login = session.legacySessionId ? active.find((g) => g.legacySessionId === session.legacySessionId) : undefined;
  if (login) return login;
  return [...active].sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())[0];
}

function legacyIdsOf(session: AuthSessionWithGrants): string[] {
  const ids = new Set<string>();
  if (session.legacySessionId) ids.add(session.legacySessionId);
  for (const g of session.grants) if (g.legacySessionId) ids.add(g.legacySessionId);
  return [...ids];
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

export function createSessionResolver(deps: SessionResolverDeps): SessionResolver {
  const { jwt, repo, revocation, flags } = deps;
  const clock = deps.now ?? (() => new Date());
  const readMode = flags.readMode;

  async function resolveJwt(
    payload: JwtPayload,
    path: AuthPath,
    legacyIdFromRequest: string | undefined,
    preview: string,
  ): Promise<ResolveResult | null> {
    if (!payload.sub) return null;
    const hasWorkspaceClaims = !!payload.memberId && !!payload.workspaceId;
    let workspaceId: string | undefined = payload.workspaceId;
    let memberId: string | undefined = payload.memberId;

    if (!hasWorkspaceClaims) {
      // Pre-workspace JWT: recover the context from the user row so old clients keep working.
      logger.info(`[AUTH] LEGACY JWT FORMAT - User ${payload.sub} using pre-workspace client`, { userId: payload.sub, path, tokenPreview: preview });
      const legacyUser = await repo.findUserById(payload.sub);
      workspaceId = legacyUser?.workspaceId ?? undefined;
      memberId = legacyUser?.orgMemberId ?? undefined;
    }
    if (!workspaceId || !memberId) {
      logger.warn(`[AUTH] No workspace context resolved for user ${payload.sub}`, { path, tokenPreview: preview, workspaceId, memberId });
      return failure('workspace_context_missing');
    }

    const [user, orgMember] = await Promise.all([repo.findUserById(payload.sub), repo.findOrgMember(memberId)]);
    if (!user) {
      logger.warn(`[AUTH] Token valid, but user not found in DB: ${payload.sub}`, { path, tokenPreview: preview });
      return null;
    }
    if (user.leftAt) {
      logger.warn(`[AUTH] User has been removed from workspace: ${user.email}`, { path, tokenPreview: preview, userId: user.id, leftAt: user.leftAt });
      return failure('workspace_user_left');
    }
    if (!orgMember || orgMember.leftAt) {
      logger.warn(`[AUTH] User has been removed from organization: ${user.email}`, { path, tokenPreview: preview, userId: user.id, orgMemberLeftAt: orgMember?.leftAt ?? null });
      return failure('account_left');
    }

    return {
      ok: true,
      auth: {
        user: toAuthenticatedUser(user, workspaceId, memberId, orgMember.role),
        workspaceId,
        session: null,
        grant: null,
        legacySession: null,
        legacySessionId: legacyIdFromRequest ?? payload.lsid ?? null,
        path,
        refreshed: null,
        jwtPayload: payload,
      },
    };
  }

  async function resolveSession(
    session: AuthSessionWithGrants,
    mappedGrant: SessionWorkspaceGrant | null,
    path: AuthPath,
    hint: string | undefined,
    input: ResolverInput,
    now: Date,
  ): Promise<ResolveResult> {
    if (session.status !== ACTIVE) {
      logger.warn('[AUTH] [Session] session not active', { sessionId: session.id, status: session.status, path });
      return failure('session_revoked');
    }
    if (session.absoluteExpiry <= now) {
      logger.warn('[AUTH] [Session] session expired', { sessionId: session.id, absoluteExpiry: session.absoluteExpiry.toISOString(), path });
      return failure('session_expired');
    }

    const orgMember = await repo.findOrgMember(session.accountId);
    if (!orgMember || orgMember.leftAt) {
      logger.warn('[AUTH] [Session] account has left the organization; revoking session', {
        sessionId: session.id,
        accountId: session.accountId,
        orgMemberLeftAt: orgMember?.leftAt?.toISOString() ?? null,
      });
      await repo.revokeSessionCascade(session.id, 'ACCOUNT_LEFT');
      return failure('account_left');
    }

    let grant: SessionWorkspaceGrant | null = null;
    let user: MembershipUser | null = null;
    let lazyGranted = false;

    if (hint) {
      grant = session.grants.find((g) => g.workspaceId === hint && isGrantActive(g, now)) ?? null;
      if (!grant) {
        if (input.allowAutoGrant === false) {
          logger.warn('[AUTH] [Session] no grant for workspace and auto-grant disabled', { sessionId: session.id, workspaceId: hint });
          return failure('workspace_forbidden');
        }
        const membership = await repo.findActiveMembership(session.accountId, hint);
        if (!membership) {
          logger.warn('[AUTH] [Session] no grant and no active membership for workspace', { sessionId: session.id, accountId: session.accountId, workspaceId: hint });
          return failure('workspace_forbidden');
        }
        const added = await repo.addGrant({
          session,
          user: membership,
          kind: 'lazy_grant',
          ip: input.ip,
          deviceInfo: input.userAgent
            ? JSON.stringify({ userAgent: input.userAgent, timestamp: now.toISOString(), platform: session.platform.toLowerCase(), grant: 'lazy' })
            : undefined,
        });
        grant = added.grant;
        user = membership;
        lazyGranted = true;
        session = { ...session, grants: session.grants.filter((g) => g.id !== grant!.id).concat(grant) };
        logger.info('[AUTH] [Session] lazy grant minted', { sessionId: session.id, grantId: grant.id, workspaceId: hint, created: added.created });
      }
    } else {
      grant = mappedGrant && isGrantActive(mappedGrant, now) ? mappedGrant : primaryGrant(session, now);
      if (!grant) {
        logger.warn('[AUTH] [Session] no workspace hint and no usable grant', { sessionId: session.id, path });
        return failure('workspace_hint_missing');
      }
    }

    user = user ?? (await repo.findUserById(grant.userId));
    if (!user) {
      logger.warn('[AUTH] [Session] grant user not found', { sessionId: session.id, grantId: grant.id, userId: grant.userId });
      return failure('user_not_found');
    }
    if (user.leftAt || user.status !== 'ACTIVE') {
      logger.warn('[AUTH] [Session] workspace user left; revoking grant', { sessionId: session.id, grantId: grant.id, userId: user.id, workspaceId: grant.workspaceId });
      await repo.revokeGrant(grant.id, 'WORKSPACE_USER_LEFT');
      return failure('workspace_user_left');
    }

    const workspaceId = grant.workspaceId;
    const legacySessionId = grant.legacySessionId ?? session.legacySessionId ?? null;
    const authUser = toAuthenticatedUser(user, workspaceId, session.accountId, orgMember.role);

    if (input.mode === 'refresh-endpoint' && !hint) {
      return {
        ok: true,
        auth: { user: authUser, workspaceId, session, grant, legacySession: null, legacySessionId, path, refreshed: null, jwtPayload: null, lazyGranted },
      };
    }

    const minted = jwt.generateToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture ?? undefined,
      workspaceId,
      memberId: session.accountId,
      providerUserId: user.providerUserId ?? undefined,
      provider: user.authProvider ?? undefined,
      sid: session.id,
      lsid: grant.legacySessionId ?? undefined,
    });
    const cookies = cookiesForRefresh({
      tokens: [{ workspaceId, jwt: minted }],
      jwtTtlSeconds: deps.jwtTtlSeconds,
      cookieMode: flags.cookieMode,
      path,
      sessionToken: session.tokenHash ? null : `${SESSION_TOKEN_PREFIX}${session.id}`,
      sessionExpiresAt: session.absoluteExpiry,
      sameSite: 'strict',
      secure: deps.secureCookies,
      now,
    });

    if (shouldTouch(session.lastSeenAt, now)) {
      await repo.touchSession(session.id, legacyIdsOf(session), now);
    }

    logger.info('[AUTH] [Session] SUCCESS: token minted from auth session', {
      sessionId: session.id,
      grantId: grant.id,
      userId: user.id,
      email: user.email,
      workspaceId,
      path,
      lazyGranted,
      tokenPreview: tokenPreview(minted),
    });
    return {
      ok: true,
      auth: { user: authUser, workspaceId, session, grant, legacySession: null, legacySessionId, path, refreshed: { jwt: minted, cookies }, jwtPayload: null, lazyGranted },
    };
  }

  async function resolveLegacy(legacy: LegacySessionWithUser, path: AuthPath, hint: string | undefined, now: Date): Promise<ResolveResult> {
    const { user: rowUser } = legacy;
    if (!rowUser) return failure('session_not_found');
    if (legacy.status !== ACTIVE) {
      logger.warn(`[AUTH] [Auto-Refresh] Session invalid: Status=${legacy.status}`, { userId: rowUser.id, email: rowUser.email, sessionStatus: legacy.status });
      return failure('session_revoked');
    }
    if (legacy.refreshTokenExpiry <= now) {
      logger.warn(`[AUTH] [Auto-Refresh] Session invalid: Expired (Expiry: ${legacy.refreshTokenExpiry.toISOString()})`, { userId: rowUser.id, email: rowUser.email });
      return failure('session_expired');
    }
    if (rowUser.orgMember?.leftAt) {
      logger.warn(`[AUTH] [Auto-Refresh] User ${rowUser.email} has left organization. Session rejected.`, { userId: rowUser.id, orgMemberLeftAt: rowUser.orgMember.leftAt.toISOString() });
      return failure('account_left');
    }
    if (rowUser.leftAt) {
      logger.warn(`[AUTH] [Auto-Refresh] Workspace user ${rowUser.email} has left workspace ${rowUser.workspaceId}. Session rejected.`, { userId: rowUser.id, userLeftAt: rowUser.leftAt.toISOString() });
      return failure('workspace_user_left');
    }

    let user: MembershipUser = rowUser;
    if (hint && hint !== rowUser.workspaceId) {
      const membership = await repo.findActiveMembership(rowUser.orgMemberId, hint);
      if (!membership) {
        logger.warn('[AUTH] [Auto-Refresh] legacy session asked for a workspace without membership', { legacySessionId: legacy.id, workspaceId: hint });
        return failure('workspace_forbidden');
      }
      user = membership;
    }
    const workspaceId = user.workspaceId;
    const orgRole = rowUser.orgMember?.role ?? '';

    const minted = jwt.generateToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture ?? undefined,
      workspaceId,
      memberId: user.orgMemberId,
      providerUserId: user.providerUserId ?? undefined,
      provider: user.authProvider ?? undefined,
      lsid: legacy.id,
    });
    const cookies = cookiesForRefresh({
      tokens: [{ workspaceId, jwt: minted }],
      jwtTtlSeconds: deps.jwtTtlSeconds,
      cookieMode: 'legacy',
      path,
      sameSite: 'strict',
      secure: deps.secureCookies,
      now,
    });

    if (shouldTouch(legacy.lastActivity, now)) {
      await repo.touchLegacySession(legacy.id, now);
    }

    logger.info('[AUTH] [Auto-Refresh] SUCCESS: Token refreshed from legacy session', {
      legacySessionId: legacy.id,
      userId: user.id,
      email: user.email,
      workspaceId,
      path,
      tokenPreview: tokenPreview(minted),
    });
    return {
      ok: true,
      auth: {
        user: toAuthenticatedUser(user, workspaceId, user.orgMemberId, orgRole),
        workspaceId,
        session: null,
        grant: null,
        legacySession: legacy,
        legacySessionId: legacy.id,
        path,
        refreshed: { jwt: minted, cookies },
        jwtPayload: null,
      },
    };
  }

  async function resolveViaSessionPath(input: ResolverInput, hint: string | undefined, now: Date): Promise<ResolveResult> {
    const cookies = input.cookies ?? {};
    const { headers } = input;

    let legacyId = cookieString(cookies, LEGACY_SESSION_COOKIE) ?? headerString(headers, LEGACY_SESSION_HEADER);
    let legacyPath: AuthPath = cookieString(cookies, LEGACY_SESSION_COOKIE) ? 'legacy_cookie' : 'legacy_header';

    // 2a. opaque session token
    if (readMode !== 'legacy') {
      const fromCookie = cookieString(cookies, SESSION_COOKIE);
      const opaque = fromCookie ?? headerString(headers, SESSION_TOKEN_HEADER);
      const opaquePath: AuthPath = fromCookie ? 'v3_cookie' : 'v3_header';
      const parsed = parseSessionToken(opaque);
      if (parsed?.kind === 'v3') {
        const session = await repo.findSessionByToken(parsed.payload);
        if (session) return resolveSession(session, null, opaquePath, hint, input, now);
        // Stale xyne_session must not mask a still-valid legacy cookie.
        logger.info('[AUTH] [Session] opaque token did not match an active session; continuing', { path: opaquePath });
      } else if (parsed?.kind === 'legacy_id' && !legacyId) {
        // Claw forges xyne_session=<legacy id>.
        legacyId = parsed.id;
        legacyPath = fromCookie ? 'legacy_cookie' : 'legacy_header';
      }
    }

    if (!legacyId) return failure('no_credentials');

    // 2b. legacy id mapped to an auth session
    if (readMode !== 'legacy') {
      const mapped = await repo.findSessionByLegacyId(legacyId);
      if (mapped) return resolveSession(mapped.session, mapped.grant, 'legacy_mapped', hint, input, now);
    }

    // 2c. raw legacy row
    if (readMode === 'v3') {
      logger.warn('[AUTH] [Session] legacy id not mapped to an auth session (READ_MODE=v3)', { legacySessionId: legacyId });
      return failure('session_not_found');
    }
    const legacy = await repo.findLegacySession(legacyId);
    if (!legacy || !legacy.user) {
      logger.warn('[AUTH] [Auto-Refresh] Session check failed: Session or user not found', { sessionFound: !!legacy, userFound: !!legacy?.user });
      return failure('session_not_found');
    }
    return resolveLegacy(legacy, legacyPath, hint, now);
  }

  async function resolve(input: ResolverInput): Promise<ResolveResult> {
    const now = clock();
    const cookies = input.cookies ?? {};
    const { headers } = input;
    const hint = input.workspaceId || headerString(headers, WORKSPACE_HEADER) || cookieString(cookies, LAST_WORKSPACE_COOKIE);
    const legacyIdFromRequest = cookieString(cookies, LEGACY_SESSION_COOKIE) ?? headerString(headers, LEGACY_SESSION_HEADER);

    // 1. JWT fast path
    let token: string | undefined;
    let path: AuthPath = 'jwt_cookie';
    const authorization = headerString(headers, 'authorization');
    if (input.allowBearer && authorization?.startsWith('Bearer ')) {
      token = authorization.slice('Bearer '.length).trim() || undefined;
      path = 'jwt_bearer';
    } else if (hint) {
      token = cookieString(cookies, wsTokenCookieName(hint));
    }

    let jwtFailure: ResolveFailureReason | null = null;
    let nearExpiryResult: ResolveResult | null = null;
    // `refresh-session` exists to mint from the session: a still-valid workspace JWT must not
    // short-circuit it (the token would never be refreshed and sid/lsid never re-validated).
    const skipJwt = input.mode === 'refresh-endpoint';
    if (token && !skipJwt) {
      const preview = tokenPreview(token);
      try {
        const payload = jwt.verifyToken(token);
        const revoked = !!payload.sid && readMode !== 'legacy' && (await revocation.isRevoked(payload.sid));
        if (revoked) {
          logger.info('[AUTH] JWT session revoked (tombstone). Falling back to session path.', { path, tokenPreview: preview, sid: payload.sid });
          jwtFailure = 'jwt_revoked';
        } else {
          const result = await resolveJwt(payload, path, legacyIdFromRequest, preview);
          if (result && !result.ok) return result;
          if (result) {
            const ahead = input.refreshAheadSeconds ?? 0;
            const secondsLeft = payload.exp ? payload.exp - Math.floor(now.getTime() / 1000) : Infinity;
            if (ahead > 0 && secondsLeft < ahead && input.allowAutoRefresh) {
              logger.info(`[AUTH] Token is about to expire in ${secondsLeft}s, refreshing through the session path`, { path, tokenPreview: preview });
              nearExpiryResult = result;
            } else {
              return result;
            }
          } else {
            jwtFailure = 'user_not_found';
          }
        }
      } catch (err) {
        const expired = err instanceof Error && err.message === 'JWT token has expired';
        jwtFailure = expired ? 'jwt_expired' : 'jwt_invalid';
        logger.info(`[AUTH] Token ${expired ? 'expired' : 'invalid'}. Falling back to session path.`, {
          path,
          tokenPreview: preview,
          ...(expired ? {} : { error: err instanceof Error ? err.message : String(err) }),
        });
      }
    }

    if (!input.allowAutoRefresh && !skipJwt) {
      return failure(jwtFailure ?? 'no_credentials');
    }

    // 2. session path
    const result = await resolveViaSessionPath(input, hint, now);
    if (result.ok) return result;
    if (nearExpiryResult) {
      // The JWT is still valid; a failed early refresh must not log the user out.
      logger.info('[AUTH] Early refresh failed; keeping the still-valid JWT', { reason: result.reason });
      return nearExpiryResult;
    }
    if (result.reason === 'no_credentials' && jwtFailure) {
      logger.warn('[AUTH] Authentication FAILED. No valid token and no session credentials.', { jwtFailure });
      return failure(jwtFailure);
    }
    return result;
  }

  return { resolve };
}

// ─── Real-dependency entry points ─────────────────────────────────────────────

let defaultResolver: SessionResolver | null = null;

function getDefaultResolver(): SessionResolver {
  if (!defaultResolver) {
    defaultResolver = createSessionResolver({
      jwt: jwtService,
      repo: authSessionRepository,
      revocation: redisRevocationStore,
      flags: getAuthSessionFlags(),
      jwtTtlSeconds: config.jwt.expirationSeconds,
      sessionExpiryDays: config.session.expiryDays,
      secureCookies: process.env.NODE_ENV === 'production',
    });
  }
  return defaultResolver;
}

function userAgentOf(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua ? ua : undefined;
}

export function resolveRequest(req: Request, opts: Omit<ResolverInput, 'cookies' | 'headers'>): Promise<ResolveResult> {
  return getDefaultResolver().resolve({
    ip: req.ip,
    userAgent: userAgentOf(req),
    ...opts,
    cookies: (req.cookies ?? {}) as Cookies,
    headers: req.headers,
  });
}

export function authSessionInfoOf(auth: ResolvedAuth): AuthSessionInfo | null {
  if (!auth.session || !auth.grant) return null;
  return {
    sessionId: auth.session.id,
    grantId: auth.grant.id,
    accountId: auth.session.accountId,
    workspaceId: auth.workspaceId,
    legacySessionId: auth.grant.legacySessionId ?? null,
    platform: auth.session.platform as SessionPlatform,
  };
}

/** Attaches the decision to the request and applies any refresh cookies. */
export function applyResolvedAuth(req: Request, res: Response, auth: ResolvedAuth): void {
  req.user = auth.user;
  req.authenticatedSessionId = auth.legacySessionId ?? auth.session?.id ?? undefined;
  const info = authSessionInfoOf(auth);
  if (info) req.authSession = info;

  if (auth.refreshed) {
    applyCookies(res, auth.refreshed.cookies);
    // Downstream handlers that re-read the workspace token cookie see the fresh one.
    if (!req.cookies) req.cookies = {};
    for (const c of auth.refreshed.cookies as CookieInstruction[]) {
      if (c.kind === 'set') req.cookies[c.name] = c.value;
    }
  }
}
