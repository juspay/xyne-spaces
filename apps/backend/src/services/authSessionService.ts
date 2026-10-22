import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { recordWorkspaceAccessTx, replaceActiveAuthSessionTx, revokeActiveAuthSessionsTx } from '@/bypassAcl/transactions/authSessionStore';
import { logger as baseLogger } from '../utils/logger';

const logger = baseLogger.child({ module: 'AuthSessionService' });

/** Persistent per-client device key header (replaces x-client-session-id). */
export const DEVICE_KEY_HEADER = 'x-device-id';

/** Org-scoped refresh token cookie. */
export const AUTH_SESSION_COOKIE = 'xs';

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
} as const;

export type DevicePlatform = 'web' | 'electron' | 'android' | 'ios';

const MAX_DEVICE_KEY_LENGTH = 128;

export interface AuthSessionIdentity {
  orgMemberId: string;
  /** Resolved from org_members when omitted. */
  orgId?: string;
  /** Workspace the user landed in; stamped on the auth session's access table. */
  workspaceId?: string;
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
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const mintToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
};

export class AuthSessionService {
  // Native mobile cookies follow the existing mobile-exchange convention
  // (sameSite none + secure); everything else matches the login-workspace cookies.
  private authSessionCookieOptions(req: Request) {
    const platform = resolveDevicePlatform(req);
    const isMobileNative = platform === 'android' || platform === 'ios';
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || isMobileNative,
      sameSite: isMobileNative ? ('none' as const) : ('strict' as const),
      path: '/',
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
   * Revoke any active row for this (orgMemberId, deviceKey), create a fresh one,
   * and hand the raw token to the client via the `xs` cookie.
   */
  private async establish(req: Request, res: Response, orgMemberId: string, orgId: string, deviceKey: string, workspaceId?: string): Promise<string> {
    const { token, tokenHash } = mintToken();
    const refreshTokenExpiry = new Date(Date.now() + config.session.expiryDays * 24 * 60 * 60 * 1000);
    const platform = resolveDevicePlatform(req);

    const session = await replaceActiveAuthSessionTx({
      orgMemberId,
      orgId,
      deviceKey,
      refreshToken: tokenHash,
      status: AuthSessionStatus.ACTIVE,
      revokedStatus: AuthSessionStatus.REVOKED,
      revokeReason: AuthSessionRevokeReason.SUPERSEDED,
      platform,
      refreshTokenExpiry,
      deviceInfo: buildDeviceInfo(req),
      workspaceId,
    });

    this.setAuthSessionCookie(req, res, token, refreshTokenExpiry);
    return session.id;
  }

  /**
   * Login: always mint a fresh auth session for the device (previous active row revoked).
   * No-op when the client did not send x-device-id. Never throws — auth session
   * issuance must not break the login response.
   */
  async issueOnLogin(req: Request, res: Response, identity: AuthSessionIdentity): Promise<void> {
    const deviceKey = getDeviceKey(req);
    if (!deviceKey) {
      logger.info('[AUTH-SESSION] Login request without x-device-id header - skipping auth session issuance', {
        orgMemberId: identity.orgMemberId,
        platform: resolveDevicePlatform(req),
        path: req.path,
      });
      return;
    }

    try {
      const orgId = await this.resolveOrgId(identity);
      if (!orgId) {
        logger.warn('[AUTH-SESSION] Could not resolve orgId for org member - skipping auth session issuance', {
          orgMemberId: identity.orgMemberId,
        });
        return;
      }

      const authSessionId = await this.establish(req, res, identity.orgMemberId, orgId, deviceKey, identity.workspaceId);
      logger.info('[AUTH-SESSION] Issued auth session on login', {
        authSessionId,
        orgId,
        orgMemberId: identity.orgMemberId,
        deviceKey,
        platform: resolveDevicePlatform(req),
      });
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to issue auth session on login', {
        orgMemberId: identity.orgMemberId,
        deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Refresh: when the `xs` cookie is missing and the device has no active auth
   * session, create one. An existing active session is left untouched (the
   * device re-attaches on next login). Never throws.
   */
  async ensureOnRefresh(req: Request, res: Response, identity: AuthSessionIdentity): Promise<void> {
    if (req.cookies?.[AUTH_SESSION_COOKIE]) return;

    const deviceKey = getDeviceKey(req);
    if (!deviceKey) {
      logger.info('[AUTH-SESSION] Refresh without xs cookie and without x-device-id header - cannot attach auth session', {
        orgMemberId: identity.orgMemberId,
        platform: resolveDevicePlatform(req),
        path: req.path,
      });
      return;
    }

    try {
      const orgId = await this.resolveOrgId(identity);
      if (!orgId) {
        logger.warn('[AUTH-SESSION] Could not resolve orgId for org member - skipping auth session attach', {
          orgMemberId: identity.orgMemberId,
        });
        return;
      }

      const active = await db.authSession.findFirst({
        where: {
          orgMemberId: identity.orgMemberId,
          deviceKey,
          status: AuthSessionStatus.ACTIVE,
          refreshTokenExpiry: { gt: new Date() },
        },
      });

      if (active) {
        logger.info('[AUTH-SESSION] Active auth session exists for device, xs cookie missing - leaving session untouched', {
          authSessionId: active.id,
          orgId,
          orgMemberId: identity.orgMemberId,
          deviceKey,
        });
        return;
      }

      const authSessionId = await this.establish(req, res, identity.orgMemberId, orgId, deviceKey, identity.workspaceId);
      logger.info('[AUTH-SESSION] Created auth session during refresh (no active session for device)', {
        authSessionId,
        orgId,
        orgMemberId: identity.orgMemberId,
        deviceKey,
      });
    } catch (error) {
      logger.error('[AUTH-SESSION] Failed to attach auth session during refresh', {
        orgMemberId: identity.orgMemberId,
        deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Logout: revoke this device's active auth session (matched by the presented xs hash and/or
   * orgMemberId + device key) with their workspace access rows, and clear the xs cookie.
   * Never throws — logout must complete regardless.
   */
  async revokeOnLogout(req: Request, res: Response, identity: { orgMemberId?: string }): Promise<void> {
    const presented = req.cookies?.[AUTH_SESSION_COOKIE];
    const deviceKey = getDeviceKey(req);
    try {
      const revoked = await revokeActiveAuthSessionsTx({
        refreshToken: typeof presented === 'string' && presented ? hashToken(presented) : undefined,
        orgMemberId: identity.orgMemberId,
        deviceKey,
        activeStatus: AuthSessionStatus.ACTIVE,
        revokedStatus: AuthSessionStatus.REVOKED,
        revokeReason: AuthSessionRevokeReason.LOGOUT,
      });
      logger.info('[AUTH-SESSION] Revoked auth session(s) on logout', {
        revoked,
        orgMemberId: identity.orgMemberId,
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
    res.clearCookie(AUTH_SESSION_COOKIE, this.authSessionCookieOptions(req));
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
