import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { config } from '@/config/env';
import { db } from '@/database/client';
import {
  recordWorkspaceAccessTx,
  replaceActiveAuthSessionTx,
  revokeActiveAuthSessionsTx,
  revokeAuthSessionByIdTx,
  revokeAuthSessionsForOrgMemberTx,
  rotateAuthSessionTokenTx,
} from '@/bypassAcl/transactions/authSessionStore';
import { redisService } from '@/services/redisService';
import { logger as baseLogger } from '../utils/logger';

const logger = baseLogger.child({ module: 'AuthSessionService' });

/**
 * Logged-out session ids, kept for one access-token lifetime: a JWT minted before
 * logout carries the sid and stays verifiable until it expires.
 */
const REVOKED_SESSION_KEY_PREFIX = 'auth:revoked-sid:';

/** Persistent per-client device key header (replaces x-client-session-id). */
export const DEVICE_KEY_HEADER = 'x-device-id';

/** Org-scoped refresh token cookie. */
export const AUTH_SESSION_COOKIE = 'xs';

/**
 * The only request the browser attaches `xs` to. Every other call carries just the
 * workspace JWT cookie; on 401 the client hits this path and retries.
 */
export const AUTH_SESSION_COOKIE_PATH = '/api/auth/refresh-session';

/** Stored as plain strings in auth_sessions / auth_session_workspace_access (values are load-bearing: the partial unique index filters on 'ACTIVE'). */
export enum AuthSessionStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export const AuthSessionRevokeReason = {
  /** A newer login (or refresh recovery after expiry) replaced the device's session. */
  SUPERSEDED: 'superseded',
  LOGOUT: 'logout',
  ADMIN_REMOVED: 'admin_removed',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  ACCOUNT_DEACTIVATED: 'account_deactivated',
  TEST_CLEANUP: 'test_cleanup',
  /** SDK SSO: a rotated refresh token was presented again after its grace window. */
  REFRESH_TOKEN_REUSED: 'refresh_token_reused',
} as const;

export type AuthSessionRevokeReason = (typeof AuthSessionRevokeReason)[keyof typeof AuthSessionRevokeReason];

export type DevicePlatform = 'web' | 'electron' | 'android' | 'ios' | 'sdk';

const MAX_DEVICE_KEY_LENGTH = 128;

export interface AuthSessionIdentity {
  orgMemberId: string;
  /** Resolved from org_members when omitted. */
  orgId?: string;
  /** Workspace the user landed in; stamped on the auth session's access table. */
  workspaceId?: string;
}

/** What a login flow needs from the auth session it just created: the JWT `sid` claim and the cap on JWT lifetime. */
export interface IssuedAuthSession {
  sessionId: string;
  refreshTokenExpiry: Date;
}

/** An active, unexpired auth session matched from the presented `xs` cookie, with the org member it belongs to. */
export interface RefreshableAuthSession {
  id: string;
  orgMemberId: string;
  orgId: string;
  deviceKey: string;
  platform: string;
  refreshTokenExpiry: Date;
  orgMember: {
    memberId: string;
    email: string;
    role: string;
    leftAt: Date | null;
  };
}

export interface ExternalAuthSessionInput {
  orgMemberId: string;
  orgId: string;
  /** Unique per external session (e.g. `sdk-<deviceCodeHash>`); the ACTIVE partial unique index is on (orgMemberId, deviceKey). */
  deviceKey: string;
  platform: DevicePlatform;
  /** Already-hashed value the caller will present on refresh; stored as-is. */
  refreshTokenHash: string;
  refreshTokenExpiry: Date;
  deviceInfo?: Record<string, unknown>;
  workspaceId?: string;
}

/** Login without the x-device-id header: no auth session can be keyed, so the login is rejected (400 by the controller). */
export class MissingDeviceKeyError extends Error {
  readonly code = 'DEVICE_ID_REQUIRED';
  constructor() {
    super(`Login requires the ${DEVICE_KEY_HEADER} header`);
    this.name = 'MissingDeviceKeyError';
  }
}

/** Sanitized device key from the request, or undefined when the client sent none. */
export const getDeviceKey = (req: Request): string | undefined => {
  const raw = req.headers[DEVICE_KEY_HEADER];
  const deviceKey = typeof raw === 'string' ? raw.trim() : undefined;
  if (!deviceKey || deviceKey.length > MAX_DEVICE_KEY_LENGTH) return undefined;
  return deviceKey;
};

/** Device platform from the x-platform header, falling back to the user agent. */
export const resolveDevicePlatform = (req: Request): DevicePlatform => {
  const platformHeader = ((req.headers['x-platform'] as string) || '').toLowerCase();
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();

  if (platformHeader === 'electron' || userAgent.includes('electron')) return 'electron';
  if (platformHeader === 'native' || platformHeader === 'mobile') {
    // The native mTLS clients send no custom user agent: Android's default is
    // okhttp, iOS's is CFNetwork/Darwin.
    return userAgent.includes('android') || userAgent.includes('okhttp') ? 'android' : 'ios';
  }
  return 'web';
};

const buildDeviceInfo = (req: Request): string =>
  JSON.stringify({
    appVersion: req.headers['x-app-version'],
    userAgent: req.headers['user-agent'],
    acceptLanguage: req.headers['accept-language'],
  });

/** Raw token travels in the `xs` cookie; only its sha256 digest is persisted. */
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const hashToken = hashRefreshToken;

/** Raw `xs` cookie value as presented by the client, or undefined. */
export const getPresentedRefreshToken = (req: Request): string | undefined => {
  const raw = req.cookies?.[AUTH_SESSION_COOKIE];
  return typeof raw === 'string' && raw ? raw : undefined;
};

const mintToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
};

export class AuthSessionService {
  // Native mobile cookies follow the existing mobile-exchange convention
  // (sameSite none + secure); everything else matches the login-workspace cookies.
  // Path-scoped so the refresh token never travels on ordinary API calls.
  private authSessionCookieOptions(req: Request) {
    const platform = resolveDevicePlatform(req);
    const isMobileNative = platform === 'android' || platform === 'ios';
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || isMobileNative,
      sameSite: isMobileNative ? ('none' as const) : ('strict' as const),
      path: AUTH_SESSION_COOKIE_PATH,
    };
  }

  private setAuthSessionCookie(req: Request, res: Response, token: string, refreshTokenExpiry: Date): void {
    res.cookie(AUTH_SESSION_COOKIE, token, {
      ...this.authSessionCookieOptions(req),
      maxAge: refreshTokenExpiry.getTime() - Date.now(),
    });
  }

  private async resolveOrgId(identity: AuthSessionIdentity): Promise<string | undefined> {
    if (identity.orgId) return identity.orgId;
    const orgMember = await db.orgMember.findUnique({
      where: { memberId: identity.orgMemberId },
      select: { orgId: true },
    });
    return orgMember?.orgId;
  }

  /**
   * Login: always mint a fresh auth session for the device (previous active row revoked)
   * and hand the raw token to the client via the `xs` cookie. The session is the login's
   * refresh credential, so failure here fails the login: throws MissingDeviceKeyError
   * without x-device-id, and rethrows storage errors.
   */
  async issueOnLogin(req: Request, res: Response, identity: AuthSessionIdentity): Promise<IssuedAuthSession> {
    const deviceKey = getDeviceKey(req);
    if (!deviceKey) {
      logger.warn('[AUTH-SESSION] Login request without x-device-id header - rejecting', {
        orgMemberId: identity.orgMemberId,
        platform: resolveDevicePlatform(req),
        path: req.path,
      });
      throw new MissingDeviceKeyError();
    }

    const orgId = await this.resolveOrgId(identity);
    if (!orgId) {
      throw new Error(`Cannot issue auth session: org member ${identity.orgMemberId} has no org`);
    }

    const { token, tokenHash } = mintToken();
    const refreshTokenExpiry = new Date(Date.now() + config.session.expiryDays * 24 * 60 * 60 * 1000);
    const platform = resolveDevicePlatform(req);

    const session = await replaceActiveAuthSessionTx({
      orgMemberId: identity.orgMemberId,
      orgId,
      deviceKey,
      refreshToken: tokenHash,
      status: AuthSessionStatus.ACTIVE,
      revokedStatus: AuthSessionStatus.REVOKED,
      revokeReason: AuthSessionRevokeReason.SUPERSEDED,
      platform,
      refreshTokenExpiry,
      deviceInfo: buildDeviceInfo(req),
      workspaceId: identity.workspaceId,
    });

    this.setAuthSessionCookie(req, res, token, refreshTokenExpiry);
    logger.info('[AUTH-SESSION] Issued auth session on login', {
      authSessionId: session.id,
      orgId,
      orgMemberId: identity.orgMemberId,
      deviceKey,
      platform,
    });
    return { sessionId: session.id, refreshTokenExpiry };
  }

  /**
   * Refresh: resolve the presented `xs` cookie to its active, unexpired auth session and
   * the org member who owns it. Null when the cookie is missing, unknown, revoked, expired,
   * or the member has left the org — the caller answers 401 and the client re-logs in.
   */
  async validateRefresh(req: Request): Promise<RefreshableAuthSession | null> {
    const presented = getPresentedRefreshToken(req);
    if (!presented) return null;

    const session = await db.authSession.findFirst({
      where: {
        refreshToken: hashToken(presented),
        status: AuthSessionStatus.ACTIVE,
        refreshTokenExpiry: { gt: new Date() },
      },
      select: { id: true, orgMemberId: true, orgId: true, deviceKey: true, platform: true, refreshTokenExpiry: true },
    });
    if (!session) return null;

    const orgMember = await db.orgMember.findUnique({
      where: { memberId: session.orgMemberId },
      select: { memberId: true, email: true, role: true, leftAt: true },
    });
    if (!orgMember || orgMember.leftAt) {
      logger.warn('[AUTH-SESSION] Refresh rejected: org member missing or left', {
        authSessionId: session.id,
        orgMemberId: session.orgMemberId,
      });
      return null;
    }

    return { ...session, orgMember };
  }

  /** The auth session row by id, or null. */
  findById(id: string) {
    return db.authSession.findUnique({ where: { id } });
  }

  /**
   * An ACTIVE, unexpired session by id (the JWT `sid`), scoped to its org member. For routes
   * that already authenticated the caller and need the session's expiry (switch/create workspace).
   */
  findActiveById(id: string, orgMemberId: string) {
    return db.authSession.findFirst({
      where: { id, orgMemberId, status: AuthSessionStatus.ACTIVE, refreshTokenExpiry: { gt: new Date() } },
      select: { id: true, orgMemberId: true, refreshTokenExpiry: true },
    });
  }

  /** Workspace this session most recently entered (login landing or latest switch), or null. */
  async lastWorkspaceId(authSessionId: string): Promise<string | null> {
    const latest = await db.authSessionWorkspaceAccess.findFirst({
      where: { authSessionId, status: AuthSessionStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
      select: { workspaceId: true },
    });
    return latest?.workspaceId ?? null;
  }

  /** Stamp a workspace on a known session (refresh/switch when the session id is already resolved). Never throws. */
  async recordWorkspaceAccessById(authSessionId: string, workspaceId: string): Promise<void> {
    try {
      await recordWorkspaceAccessTx(authSessionId, workspaceId, AuthSessionStatus.ACTIVE);
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to record workspace access', {
        authSessionId,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Sign an org member out of every device (password change/reset, deactivation). Returns the revoked count. */
  async revokeAllForOrgMember(orgMemberId: string, reason: AuthSessionRevokeReason): Promise<number> {
    const revokedIds = await revokeAuthSessionsForOrgMemberTx(orgMemberId, AuthSessionStatus.ACTIVE, AuthSessionStatus.REVOKED, reason);
    await this.markSessionsRevoked(revokedIds);
    logger.info('[AUTH-SESSION] Revoked all auth sessions for org member', { orgMemberId, reason, revoked: revokedIds.length });
    return revokedIds.length;
  }

  /** Revoke one auth session by id. Returns true when a row was revoked. */
  async revokeById(id: string, reason: AuthSessionRevokeReason): Promise<boolean> {
    const revokedIds = await revokeAuthSessionByIdTx(id, AuthSessionStatus.ACTIVE, AuthSessionStatus.REVOKED, reason);
    await this.markSessionsRevoked(revokedIds);
    logger.info('[AUTH-SESSION] Revoked auth session by id', { authSessionId: id, reason, revoked: revokedIds.length });
    return revokedIds.length > 0;
  }

  /**
   * Create an auth session for a non-browser client (SDK SSO) that manages its own
   * refresh token: no cookie is set and the caller supplies the stored hash.
   */
  async createExternalSession(input: ExternalAuthSessionInput): Promise<IssuedAuthSession> {
    const session = await replaceActiveAuthSessionTx({
      orgMemberId: input.orgMemberId,
      orgId: input.orgId,
      deviceKey: input.deviceKey,
      refreshToken: input.refreshTokenHash,
      status: AuthSessionStatus.ACTIVE,
      revokedStatus: AuthSessionStatus.REVOKED,
      revokeReason: AuthSessionRevokeReason.SUPERSEDED,
      platform: input.platform,
      refreshTokenExpiry: input.refreshTokenExpiry,
      deviceInfo: JSON.stringify(input.deviceInfo ?? {}),
      workspaceId: input.workspaceId,
    });
    logger.info('[AUTH-SESSION] Created external auth session', {
      authSessionId: session.id,
      orgMemberId: input.orgMemberId,
      platform: input.platform,
      deviceKey: input.deviceKey,
    });
    return { sessionId: session.id, refreshTokenExpiry: input.refreshTokenExpiry };
  }

  /**
   * Compare-and-set the stored refresh-token hash of an active session (SDK SSO rotation).
   * False when the session is no longer active or another refresh rotated it first.
   */
  async rotateTokenHash(id: string, currentHash: string, nextHash: string): Promise<boolean> {
    const rotated = await rotateAuthSessionTokenTx(id, currentHash, nextHash, AuthSessionStatus.ACTIVE);
    return rotated > 0;
  }

  /**
   * Logout: revoke this device's active auth session (matched by the JWT's sid and/or
   * orgMemberId + device key; `xs` itself is not sent here) with their workspace access rows,
   * and clear the xs cookie. Never throws — logout must complete regardless.
   */
  async revokeOnLogout(req: Request, res: Response, identity: { orgMemberId?: string; sessionId?: string }): Promise<void> {
    const presented = getPresentedRefreshToken(req);
    const deviceKey = getDeviceKey(req);
    const revokedIds: string[] = [];
    try {
      const revoked = await revokeActiveAuthSessionsTx({
        id: identity.sessionId,
        refreshToken: typeof presented === 'string' && presented ? hashToken(presented) : undefined,
        orgMemberId: identity.orgMemberId,
        deviceKey,
        activeStatus: AuthSessionStatus.ACTIVE,
        revokedStatus: AuthSessionStatus.REVOKED,
        revokeReason: AuthSessionRevokeReason.LOGOUT,
      });
      revokedIds.push(...revoked);
      logger.info('[AUTH-SESSION] Revoked auth session(s) on logout', {
        revoked: revoked.length,
        orgMemberId: identity.orgMemberId,
        sessionId: identity.sessionId,
        deviceKey,
        hadCookie: !!presented,
      });
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to revoke auth session on logout', {
        orgMemberId: identity.orgMemberId,
        deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (identity.sessionId && !revokedIds.includes(identity.sessionId)) {
      revokedIds.push(identity.sessionId);
    }
    await this.markSessionsRevoked(revokedIds);
    res.clearCookie(AUTH_SESSION_COOKIE, this.authSessionCookieOptions(req));
  }

  /** Deny access JWTs carrying these sids until the longest-lived one has expired. Never throws. */
  private async markSessionsRevoked(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map(sessionId => this.markSessionRevoked(sessionId)));
  }

  private async markSessionRevoked(sessionId: string): Promise<void> {
    try {
      await redisService.set(`${REVOKED_SESSION_KEY_PREFIX}${sessionId}`, '1', config.jwt.expirationSeconds);
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to mark auth session revoked', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** True when the sid was logged out within the last access-token lifetime. Fails open on Redis errors. */
  async isSessionRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await redisService.get(`${REVOKED_SESSION_KEY_PREFIX}${sessionId}`)) !== null;
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to read revoked auth session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Switch: stamp the workspace on the device's active auth session. Skips (logs) when the
   * device has no active session for this org member, e.g. no x-device-id or a cross-org
   * target. Never throws.
   */
  async recordWorkspaceAccess(req: Request, identity: { orgMemberId: string; workspaceId: string }): Promise<void> {
    const deviceKey = getDeviceKey(req);
    if (!deviceKey) return;

    try {
      const active = await db.authSession.findFirst({
        where: {
          orgMemberId: identity.orgMemberId,
          deviceKey,
          status: AuthSessionStatus.ACTIVE,
          refreshTokenExpiry: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!active) {
        logger.info('[AUTH-SESSION] No active auth session for device - skipping workspace access record', {
          orgMemberId: identity.orgMemberId,
          workspaceId: identity.workspaceId,
          deviceKey,
        });
        return;
      }
      await recordWorkspaceAccessTx(active.id, identity.workspaceId, AuthSessionStatus.ACTIVE);
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to record workspace access', {
        orgMemberId: identity.orgMemberId,
        workspaceId: identity.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const authSessionService = new AuthSessionService();
