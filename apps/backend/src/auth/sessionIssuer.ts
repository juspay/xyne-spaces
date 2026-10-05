/**
 * Session issuance: login, workspace switch (grant on an existing session) and refresh
 * (JWT per grant). Decides nothing about cookies itself beyond calling the pure
 * `sessionCookies` helpers; the canary (`AUTH_V3_ORGS`) is consulted here, at issuance.
 */
import type { Request } from 'express';
import type { SessionWorkspaceGrant } from '@prisma/client';
import { SessionStatus } from '@xyne/shared';
import { config } from '@/config/env';
import { jwtService } from '@/services/jwtService';
import { logger } from '@/utils/logger';
import { recordSessionIssued } from '@/services/otel/authMetrics';
import {
  addGrant,
  createLegacySessionForSwitch,
  createSessionWithGrant,
  findLegacySession,
  findSessionById,
  findSessionByLegacyId,
  findUserById,
  isGrantActive,
} from '@/bypassAcl/authSessionServices';
import { MAX_REFRESH_TOKENS_PER_SESSION } from './constants';
import { effectiveIssuanceModes, getAuthSessionFlags } from './flags';
import { looksLegacyClient } from './platform';
import { cookiesForIssuance, cookiesForRefresh } from './sessionCookies';
import { SESSION_TOKEN_PREFIX } from './sessionTokens';
import type {
  AuthSessionWithGrants,
  CookieInstruction,
  IssueLoginInput,
  IssueRefreshInput,
  IssueWorkspaceSwitchInput,
  Issuance,
  MintWorkspaceJwtInput,
  RequestPlatform,
} from './types';

/** The "already signed in" session a switch/create/join was given cannot be used; callers may fall back to a fresh login. */
export class ExistingSessionUnusableError extends Error {
  constructor(message: string, readonly ref: IssueWorkspaceSwitchInput['current']) {
    super(message);
    this.name = 'ExistingSessionUnusableError';
  }
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

function headerString(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

export function buildDeviceInfo(req: Request, platform: RequestPlatform | 'sdk', now: Date = new Date()): string {
  return JSON.stringify({
    userAgent: headerString(req, 'user-agent'),
    acceptLanguage: headerString(req, 'accept-language'),
    timestamp: now.toISOString(),
    platform,
    appVersion: headerString(req, 'x-app-version'),
  });
}

export function ipFromRequest(req: Request): string | undefined {
  return req.ip || req.socket?.remoteAddress || undefined;
}

/** Re-derivable client token: only in SESSION_TOKEN_MODE=legacy (payload == id). */
function reissuableSessionToken(session: Pick<AuthSessionWithGrants, 'id' | 'tokenHash'>): string | null {
  return session.tokenHash ? null : `${SESSION_TOKEN_PREFIX}${session.id}`;
}

export function mintWorkspaceJwt(input: MintWorkspaceJwtInput): string {
  const { user } = input;
  return jwtService.generateToken(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture ?? undefined,
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      providerUserId: user.providerUserId ?? undefined,
      provider: input.provider ?? user.authProvider ?? undefined,
      sid: input.sid,
      lsid: input.lsid,
    },
    input.expiresInSeconds ? { expiresInSeconds: input.expiresInSeconds } : undefined,
  );
}

export async function issueLogin(input: IssueLoginInput): Promise<Issuance> {
  const { user, orgMember, req, platform, loginMethod, sameSite } = input;
  const now = new Date();
  const flags = getAuthSessionFlags();
  const modes = effectiveIssuanceModes(orgMember.orgId, flags);

  const created = await createSessionWithGrant({
    user,
    orgMember,
    platform,
    loginMethod,
    amr: input.amr,
    ip: ipFromRequest(req),
    deviceInfo: buildDeviceInfo(req, platform, now),
    now,
  });

  const jwt = mintWorkspaceJwt({
    user,
    memberId: orgMember.memberId,
    workspaceId: user.workspaceId,
    sid: created.session?.id,
    lsid: created.legacySession.id,
  });

  const cookies = cookiesForIssuance({
    cookieMode: modes.cookie,
    sessionToken: created.sessionToken,
    legacySessionId: created.legacySession.id,
    workspaceId: user.workspaceId,
    jwt,
    jwtTtlSeconds: config.jwt.expirationSeconds,
    sessionExpiresAt: created.sessionExpiresAt,
    sameSite,
    secure: secureCookies(),
    setLastWorkspace: true,
    looksLegacy: platform !== 'sdk' && looksLegacyClient(req),
    now,
  });

  recordSessionIssued({ kind: 'login', writeMode: modes.write, cookieMode: modes.cookie, tokenMode: flags.tokenMode });
  logger.info('[AUTH] [Issuer] login issued', {
    userId: user.id,
    workspaceId: user.workspaceId,
    accountId: orgMember.memberId,
    sessionId: created.session?.id ?? null,
    legacySessionId: created.legacySession.id,
    platform,
    loginMethod,
    writeMode: modes.write,
    cookieMode: modes.cookie,
  });

  return {
    session: created.session,
    grant: created.grant,
    legacySessionId: created.legacySession.id,
    sessionToken: created.sessionToken,
    jwt,
    cookies,
    workspaceId: user.workspaceId,
    sessionExpiresAt: created.sessionExpiresAt,
  };
}

async function resolveCurrentSession(
  current: IssueWorkspaceSwitchInput['current'],
  now: Date,
): Promise<{ session: AuthSessionWithGrants } | { legacy: NonNullable<Awaited<ReturnType<typeof findLegacySession>>> }> {
  if (current.sessionId) {
    const session = await findSessionById(current.sessionId);
    if (!session || session.status !== SessionStatus.ACTIVE || session.absoluteExpiry <= now) {
      throw new ExistingSessionUnusableError('Current auth session is not active', current);
    }
    return { session };
  }
  if (!current.legacySessionId) {
    throw new ExistingSessionUnusableError('No current session reference', current);
  }
  // A dual-written legacy id still belongs to an auth session: keep grants in step regardless
  // of READ_MODE (what the resolver honours is a separate question from what we maintain).
  const mapped = await findSessionByLegacyId(current.legacySessionId);
  if (mapped && mapped.session.status === SessionStatus.ACTIVE && mapped.session.absoluteExpiry > now) {
    return { session: mapped.session };
  }
  const legacy = await findLegacySession(current.legacySessionId);
  if (!legacy || legacy.status !== SessionStatus.ACTIVE || legacy.refreshTokenExpiry <= now) {
    throw new ExistingSessionUnusableError('Current legacy session is not active', current);
  }
  return { legacy };
}

/**
 * Adds a grant (+ legacy row) for `targetUser` to the caller's existing session. Never rewrites
 * `user_session_id`; always writes the workspace hint.
 */
export async function issueWorkspaceSwitch(input: IssueWorkspaceSwitchInput): Promise<Issuance> {
  const { current, targetUser, req, platform, loginMethod, sameSite } = input;
  const kind = input.kind ?? 'switch';
  const now = new Date();
  const flags = getAuthSessionFlags();
  const ip = ipFromRequest(req);
  const deviceInfo = buildDeviceInfo(req, platform, now);
  const resolved = await resolveCurrentSession(current, now);

  if ('session' in resolved) {
    const { session } = resolved;
    const modes = effectiveIssuanceModes(session.orgId, flags);
    const added = await addGrant({ session, user: targetUser, kind, ip, deviceInfo, loginMethod, now });
    // An auth_sessions id is never a valid workflow.user_sessions id (fcm / encryption index that
    // table by Issuance.legacySessionId). Dual-write always produces one; v3 is refused at boot.
    const legacySessionId = added.legacySessionId ?? session.legacySessionId;
    if (!legacySessionId) {
      throw new Error(`[AUTH] [Issuer] grant for session ${session.id} has no legacy row (WRITE_MODE=v3 is not supported yet)`);
    }
    const jwt = mintWorkspaceJwt({
      user: targetUser,
      memberId: session.accountId,
      workspaceId: targetUser.workspaceId,
      sid: session.id,
      lsid: added.legacySessionId ?? undefined,
    });
    const sessionToken = reissuableSessionToken(session);
    const cookies = cookiesForIssuance({
      cookieMode: modes.cookie,
      sessionToken,
      legacySessionId,
      workspaceId: targetUser.workspaceId,
      jwt,
      jwtTtlSeconds: config.jwt.expirationSeconds,
      sessionExpiresAt: session.absoluteExpiry,
      sameSite,
      secure: secureCookies(),
      setLastWorkspace: true,
      looksLegacy: looksLegacyClient(req),
      writeLegacyCookie: false,
      now,
    });
    recordSessionIssued({ kind: 'switch', writeMode: modes.write, cookieMode: modes.cookie, tokenMode: flags.tokenMode });
    logger.info('[AUTH] [Issuer] workspace switch issued', {
      sessionId: session.id,
      grantId: added.grant.id,
      created: added.created,
      workspaceId: targetUser.workspaceId,
      legacySessionId,
      kind,
    });
    const grants = session.grants.filter((g) => g.id !== added.grant.id).concat(added.grant);
    return {
      session: { ...session, grants },
      grant: added.grant,
      legacySessionId,
      sessionToken,
      jwt,
      cookies,
      workspaceId: targetUser.workspaceId,
      sessionExpiresAt: session.absoluteExpiry,
    };
  }

  const { legacy } = resolved;
  const { row } = await createLegacySessionForSwitch({
    user: targetUser,
    refreshToken: legacy.refreshToken,
    refreshTokenExpiry: legacy.refreshTokenExpiry,
    loginMethod,
    platform,
    ip,
    deviceInfo,
    now,
  });
  const jwt = mintWorkspaceJwt({
    user: targetUser,
    memberId: targetUser.orgMemberId,
    workspaceId: targetUser.workspaceId,
    lsid: row.id,
  });
  const cookies = cookiesForIssuance({
    cookieMode: 'legacy',
    sessionToken: null,
    legacySessionId: row.id,
    workspaceId: targetUser.workspaceId,
    jwt,
    jwtTtlSeconds: config.jwt.expirationSeconds,
    sessionExpiresAt: legacy.refreshTokenExpiry,
    sameSite,
    secure: secureCookies(),
    setLastWorkspace: true,
    looksLegacy: looksLegacyClient(req),
    writeLegacyCookie: false,
    now,
  });
  recordSessionIssued({ kind: 'switch', writeMode: 'legacy', cookieMode: 'legacy', tokenMode: flags.tokenMode });
  logger.info('[AUTH] [Issuer] workspace switch issued (legacy-only session)', {
    currentLegacySessionId: legacy.id,
    legacySessionId: row.id,
    workspaceId: targetUser.workspaceId,
    kind,
  });
  return {
    session: null,
    grant: null,
    legacySessionId: row.id,
    sessionToken: null,
    jwt,
    cookies,
    workspaceId: targetUser.workspaceId,
    sessionExpiresAt: legacy.refreshTokenExpiry,
  };
}

export interface RefreshToken {
  workspaceId: string;
  jwt: string;
  grant: SessionWorkspaceGrant;
}

/**
 * One JWT per active grant (or only the hinted one), capped at MAX_REFRESH_TOKENS_PER_SESSION.
 * Never writes the hint cookie. Grants whose workspace user is gone are skipped, not revoked —
 * the resolver handles that on the next request for that workspace.
 */
export async function issueRefresh(input: IssueRefreshInput): Promise<{ tokens: RefreshToken[]; cookies: CookieInstruction[] }> {
  const { session, hint, sameSite, path } = input;
  const now = new Date();
  const modes = effectiveIssuanceModes(session.orgId);
  const candidates = input.grants
    .filter((g) => isGrantActive(g, now))
    .filter((g) => !hint || g.workspaceId === hint)
    .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())
    .slice(0, MAX_REFRESH_TOKENS_PER_SESSION);

  const tokens: RefreshToken[] = [];
  for (const grant of candidates) {
    const user = await findUserById(grant.userId);
    if (!user || user.leftAt || user.status !== 'ACTIVE') {
      logger.warn('[AUTH] [Issuer] refresh skipped grant: workspace user unavailable', {
        sessionId: session.id,
        grantId: grant.id,
        workspaceId: grant.workspaceId,
      });
      continue;
    }
    tokens.push({
      workspaceId: grant.workspaceId,
      grant,
      jwt: mintWorkspaceJwt({
        user,
        memberId: session.accountId,
        workspaceId: grant.workspaceId,
        sid: session.id,
        lsid: grant.legacySessionId ?? undefined,
      }),
    });
  }

  const cookies = cookiesForRefresh({
    tokens: tokens.map((t) => ({ workspaceId: t.workspaceId, jwt: t.jwt })),
    jwtTtlSeconds: config.jwt.expirationSeconds,
    cookieMode: modes.cookie,
    path,
    sessionToken: reissuableSessionToken(session),
    sessionExpiresAt: session.absoluteExpiry,
    sameSite,
    secure: secureCookies(),
    now,
  });
  return { tokens, cookies };
}
