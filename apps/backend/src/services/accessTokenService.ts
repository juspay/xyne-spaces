/**
 * Access-token minting on top of an auth session.
 *
 * Every login, workspace switch and refresh mints the JWT the same way: claims from the
 * workspace user, `sid` from the auth session, lifetime capped by the session's expiry.
 * The cookie writers live here too so the nine inline copies in the auth controllers
 * collapse to one: `xyne_ws_<workspaceId>_token` (the JWT, maxAge = its lifetime) and
 * `xyne_last_workspace` (which workspace `/auth/refresh-session` re-mints for).
 */

import type { Request, Response } from 'express';
import { config } from '@/config/env';
import { jwtService, type JwtPayload } from './jwtService';

/** The workspace user the token is for (a `users` row) and its org member. */
export interface AccessTokenSubject {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  workspaceId: string;
  orgMemberId: string;
}

export interface MintAccessTokenInput {
  user: AccessTokenSubject;
  /** auth_sessions.id → JWT `sid` claim. */
  sessionId: string;
  /** auth_sessions.refreshTokenExpiry: the JWT never outlives the session. */
  refreshTokenExpiry: Date;
}

export interface MintedAccessToken {
  token: string;
  /** Seconds the token (and its cookie) lives: min(JWT_EXPIRATION_SECONDS, time left on the session). */
  lifetimeSeconds: number;
  /** Epoch ms the token expires; returned to the dashboard so it can refresh shortly before. */
  expiresAt: number;
}

/**
 * Pending OAuth identity between the provider callback and /auth/login-workspace (10 min,
 * httpOnly): a signed JWT holding the profile + the Redis key of the provider tokens.
 * Not an access token — nothing authenticates with it.
 */
export const PENDING_AUTH_COOKIE = 'xyne_pending_auth';

export const WORKSPACE_TOKEN_COOKIE_PREFIX = 'xyne_ws_';
export const LAST_WORKSPACE_COOKIE = 'xyne_last_workspace';

export const workspaceTokenCookieName = (workspaceId: string): string => `${WORKSPACE_TOKEN_COOKIE_PREFIX}${workspaceId}_token`;

/**
 * Per-flow deviations from the default strict/secure-in-prod cookie: the OAuth callback
 * redirect lands cross-site from the provider (`lax`), native mobile needs `none`.
 */
export interface AccessCookieOverrides {
  sameSite?: 'strict' | 'lax' | 'none';
  secure?: boolean;
}

const accessCookieOptions = (overrides?: AccessCookieOverrides) => ({
  httpOnly: true,
  secure: overrides?.secure ?? config.env === 'production',
  sameSite: overrides?.sameSite ?? ('strict' as const),
  path: '/',
});

export function mintAccessToken({ user, sessionId, refreshTokenExpiry }: MintAccessTokenInput): MintedAccessToken {
  const lifetimeSeconds = jwtService.getAccessTokenLifetimeSeconds(refreshTokenExpiry);
  const token = jwtService.generateToken(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture ?? undefined,
      workspaceId: user.workspaceId,
      memberId: user.orgMemberId,
      sid: sessionId,
    },
    lifetimeSeconds,
  );
  return { token, lifetimeSeconds, expiresAt: Date.now() + lifetimeSeconds * 1000 };
}

/** Set the JWT cookie for `workspaceId` and point `xyne_last_workspace` at it. */
export function setAccessCookies(
  res: Response,
  workspaceId: string,
  minted: MintedAccessToken,
  overrides?: AccessCookieOverrides,
): void {
  const options = accessCookieOptions(overrides);
  res.cookie(workspaceTokenCookieName(workspaceId), minted.token, {
    ...options,
    maxAge: minted.lifetimeSeconds * 1000,
  });
  res.cookie(LAST_WORKSPACE_COOKIE, workspaceId, {
    ...options,
    maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
  });
}

/** Mint and set in one go; returns the minted token for callers that also put it in the body. */
export function issueAccessCookies(
  res: Response,
  input: MintAccessTokenInput,
  overrides?: AccessCookieOverrides,
): MintedAccessToken {
  const minted = mintAccessToken(input);
  setAccessCookies(res, input.user.workspaceId, minted, overrides);
  return minted;
}

export type WorkspaceJwtRead =
  | { status: 'valid'; workspaceId: string; payload: JwtPayload }
  | { status: 'expired' | 'invalid'; workspaceId: string }
  | { status: 'missing' };

/**
 * Read and verify the workspace JWT cookie of a request outside the auth middlewares (public
 * routes that want to know whether the caller is signed in). Workspace from `x-workspace-id`,
 * else `xyne_last_workspace`, else `workspaceId` when given. `expired` lets the caller answer
 * 401 so the client refreshes and retries.
 */
export function readWorkspaceJwt(req: Request, workspaceId?: string): WorkspaceJwtRead {
  const targetWorkspaceId =
    workspaceId ?? (req.headers['x-workspace-id'] as string | undefined) ?? req.cookies?.[LAST_WORKSPACE_COOKIE];
  if (typeof targetWorkspaceId !== 'string' || !targetWorkspaceId) return { status: 'missing' };

  const token = req.cookies?.[workspaceTokenCookieName(targetWorkspaceId)];
  if (typeof token !== 'string' || !token) return { status: 'missing' };

  try {
    return { status: 'valid', workspaceId: targetWorkspaceId, payload: jwtService.verifyToken(token) };
  } catch (error) {
    const expired = error instanceof Error && error.message === 'JWT token has expired';
    return { status: expired ? 'expired' : 'invalid', workspaceId: targetWorkspaceId };
  }
}

/** Clear the JWT cookie for one workspace (logout). */
export function clearWorkspaceTokenCookie(res: Response, workspaceId: string): void {
  res.clearCookie(workspaceTokenCookieName(workspaceId), { path: '/' });
}
