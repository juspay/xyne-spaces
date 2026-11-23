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
import { authSessionService } from './authSessionService';

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

/**
 * Clear every workspace JWT cookie the request carries and the `xyne_last_workspace` pointer.
 * Used when a session ends server-side (logout, refresh denied) so the browser does not keep
 * presenting tokens that will only earn it more 401s/403s.
 */
export function clearAccessCookies(req: Request, res: Response): void {
  for (const cookieName of Object.keys(req.cookies ?? {})) {
    if (cookieName.startsWith(WORKSPACE_TOKEN_COOKIE_PREFIX) && cookieName.endsWith('_token')) {
      res.clearCookie(cookieName, { path: '/' });
    }
  }
  res.clearCookie(LAST_WORKSPACE_COOKIE, { path: '/' });
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

/** A verified access token whose `sid` is a live auth session. */
export type SessionJwtPayload = JwtPayload & { sid: string };

export type WorkspaceJwtRead =
  | { status: 'valid'; workspaceId: string; token: string; payload: SessionJwtPayload }
  /**
   * - `expired`: past `exp`; the session may still be alive, so the client refreshes and retries.
   * - `invalid`: bad signature, malformed, no `sid`, or claims that do not match the cookie's workspace.
   * - `revoked`: the auth session behind `sid` is no longer ACTIVE (logout, password change/reset,
   *   superseded by a newer login on the device, admin revoke) or has expired. Final: refresh cannot help.
   */
  | { status: 'expired' | 'invalid' | 'revoked'; workspaceId: string; token: string; reason: string }
  | { status: 'missing'; workspaceId?: string };

/**
 * Read and verify the workspace JWT cookie. The ONLY way a user access token is accepted: the
 * auth middleware and the public routes that ask "is this caller signed in" (login-workspace,
 * join requests, call-invite routing) all go through here, so none of them can skip a check.
 *
 * Workspace: `workspaceId` when given, else `x-workspace-id`, else `xyne_last_workspace`. The token
 * must be signed, carry `sub`/`memberId`/`sid`, be minted for that workspace, and its `sid` must
 * be an ACTIVE, unexpired `auth_sessions` row of the token's org member. The session is read from
 * Postgres on every call: it is the record logout and revocation write, so a revoked session is
 * rejected as soon as the revoke commits. A database error propagates (fails closed).
 */
export async function readWorkspaceJwt(req: Request, workspaceId?: string): Promise<WorkspaceJwtRead> {
  const header = req.headers['x-workspace-id'];
  const cookie = req.cookies?.[LAST_WORKSPACE_COOKIE];
  const targetWorkspaceId =
    workspaceId ||
    (typeof header === 'string' && header ? header : undefined) ||
    (typeof cookie === 'string' && cookie ? cookie : undefined);
  if (!targetWorkspaceId) return { status: 'missing' };

  const token = req.cookies?.[workspaceTokenCookieName(targetWorkspaceId)];
  if (typeof token !== 'string' || !token) return { status: 'missing', workspaceId: targetWorkspaceId };

  const rejected = (status: 'expired' | 'invalid' | 'revoked', reason: string): WorkspaceJwtRead => ({
    status,
    workspaceId: targetWorkspaceId,
    token,
    reason,
  });

  let payload: JwtPayload;
  try {
    payload = jwtService.verifyToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message === 'JWT token has expired' ? rejected('expired', message) : rejected('invalid', message);
  }

  if (!payload.sub || !payload.memberId || payload.workspaceId !== targetWorkspaceId) {
    return rejected('invalid', 'claims do not match the request');
  }
  // Every token minted since auth sessions exist carries `sid`; one without it cannot be revoked.
  if (!payload.sid) return rejected('invalid', 'no session id');

  const session = await authSessionService.findActiveById(payload.sid, payload.memberId);
  if (!session) return rejected('revoked', 'auth session is not active');

  return { status: 'valid', workspaceId: targetWorkspaceId, token, payload: { ...payload, sid: payload.sid } };
}

/** Clear the JWT cookie for one workspace (logout). */
export function clearWorkspaceTokenCookie(res: Response, workspaceId: string): void {
  res.clearCookie(workspaceTokenCookieName(workspaceId), { path: '/' });
}
