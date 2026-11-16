/**
 * The tail every login flow shares once the workspace user is resolved:
 * auth session (`xs`) → access cookies (JWT with `sid`) → activity event → contacts grant.
 *
 * Replaces `UserSessionService.createSession` + the inline cookie writers. A login
 * without `x-device-id` cannot be keyed to a device, so `issueOnLogin` throws
 * MissingDeviceKeyError; callers answer it with `respondDeviceKeyRequired`.
 */

import type { Request, Response } from 'express';
import { AuthProvider, Platform } from '@xyne/shared';
import {
  authSessionService,
  MissingDeviceKeyError,
  resolveDevicePlatform,
  type DevicePlatform,
  type IssuedAuthSession,
} from './authSessionService';
import { issueAccessCookies, type AccessCookieOverrides, type AccessTokenSubject, type MintedAccessToken } from './accessTokenService';
import { userActivityTrackingService } from './userActivityTrackingService';
import { syncContactsGrantForUser } from './userContactsService';
import { logger } from '../utils/logger';

/** How the session was minted — the AUTH/LOGIN activity event's label (closed union, as before). */
export type LoginMethod =
  | AuthProvider
  | 'TEST'
  | 'WORKSPACE_CREATED' // already signed in — a session for a workspace they just created
  | 'AUTO_LOGIN' // single-workspace auto-login straight from the OAuth callback
  | 'SDK_SSO'; // a Spaces SDK / MCP / CLI sign-in approved through Xyne SSO

/** Why a session ended — the AUTH/LOGOUT activity event's label. */
export type LogoutReason =
  | 'USER_LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'PROVIDER_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REUSED'
  | 'TEST_CLEANUP';

export interface ProviderTokens {
  refreshToken?: string | null;
  accessToken?: string | null;
  accessTokenExpiry?: Date | null;
}

export interface CompleteLoginInput {
  user: AccessTokenSubject & { authProvider?: string | null };
  /** Resolved from org_members when omitted. */
  orgId?: string;
  loginMethod: LoginMethod;
  /** Google/Microsoft tokens from the OAuth exchange; only used to seed the contacts grant. */
  providerTokens?: ProviderTokens;
  cookieOptions?: AccessCookieOverrides;
}

export interface CompletedLogin extends IssuedAuthSession {
  accessToken: MintedAccessToken;
}

/** Activity-log platform from the device platform header/user agent. */
export const toActivityPlatform = (platform: DevicePlatform): Platform => {
  if (platform === 'electron') return Platform.ELECTRON;
  if (platform === 'android' || platform === 'ios') return Platform.MOBILE;
  return Platform.WEB;
};

export async function completeLogin(req: Request, res: Response, input: CompleteLoginInput): Promise<CompletedLogin> {
  const { user } = input;

  const issued = await authSessionService.issueOnLogin(req, res, {
    orgMemberId: user.orgMemberId,
    orgId: input.orgId,
    workspaceId: user.workspaceId,
  });

  const accessToken = issueAccessCookies(
    res,
    { user, sessionId: issued.sessionId, refreshTokenExpiry: issued.refreshTokenExpiry },
    input.cookieOptions,
  );

  void userActivityTrackingService.trackLogin(user.id, {
    sessionId: issued.sessionId,
    method: input.loginMethod,
    platform: toActivityPlatform(resolveDevicePlatform(req)),
    metadata: { authProvider: user.authProvider ?? null },
  });

  const provider = user.authProvider as AuthProvider | undefined;
  if (
    input.providerTokens &&
    input.loginMethod !== 'SDK_SSO' &&
    (provider === AuthProvider.GOOGLE || provider === AuthProvider.MICROSOFT)
  ) {
    void syncContactsGrantForUser({
      provider,
      userId: user.id,
      userEmail: user.email,
      refreshToken: input.providerTokens.refreshToken,
      accessToken: input.providerTokens.accessToken,
      accessTokenExpiry: input.providerTokens.accessTokenExpiry,
    });
  }

  return { ...issued, accessToken };
}

/** Log the AUTH/LOGOUT event for a session the caller is ending. Fire-and-forget. */
export function trackLogout(req: Request, userId: string, sessionId: string, reason: LogoutReason): void {
  void userActivityTrackingService.trackLogout(userId, {
    sessionId,
    reason,
    platform: toActivityPlatform(resolveDevicePlatform(req)),
  });
}

/**
 * Answer a login that failed for want of `x-device-id` with a 400. Returns false (and
 * sends nothing) for any other error so the caller's own error handling runs.
 */
export function respondDeviceKeyRequired(res: Response, error: unknown): boolean {
  if (!(error instanceof MissingDeviceKeyError)) return false;
  logger.warn('[LOGIN] Rejected: x-device-id header missing');
  res.status(400).json({
    error: 'Device id required',
    code: error.code,
    message: error.message,
  });
  return true;
}
