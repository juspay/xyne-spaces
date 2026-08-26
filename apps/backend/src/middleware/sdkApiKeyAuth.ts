/**
 * SDK authentication for `/api/sdk`.
 *
 * Supports two authentication methods:
 * 1. API Keys (`xyne_sk_...`) - JWT-based keys stored in database
 * 2. SSO JWTs (`xyne_sso_...`) - Signed JWT tokens from device flow
 *
 * The key format, minting, and verification live in `api/sdk/auth.ts` — this
 * file is the Express middleware that calls into that and attaches the
 * principal, so it can be passed at the mount site the way every other
 * route-specific auth in this app is (`authMiddleware.authenticate`,
 * `validateS2SKey`, …), rather than being invisible inside the router it
 * protects.
 *
 * An expired key is reported as such, since the caller can act on that. Every
 * other failure returns the same `unauthenticated` error: distinguishing "no
 * such key" from "key for a deleted user" would let a caller probe which keys
 * exist.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Context } from '@xyne/shared';
import type { AuthData } from '@/zero/mutators';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { verifyApiKey, API_KEY_PREFIX, SDK_API_KEY_STATUS, type KeyIdentity, type SdkAuth } from '@/api/sdk/auth';
import { sdkJwtService, SDK_SSO_TOKEN_PREFIX, type SdkJwtPayload } from '@/services/sdkJwtService';
import { SdkApiError } from '@/api/sdk/errors';

/** `sdk_api_keys.status` — see `SDK_API_KEY_STATUSES` in `api/sdk/auth.ts`. */
const REVOKED = SDK_API_KEY_STATUS.REVOKED;

/**
 * Authenticate an API key (`xyne_sk_...`) and attach the acting principal as `req.sdkAuth`.
 */
async function authenticateApiKey(req: Request, token: string): Promise<void> {
  // Verify the JWT signature and claims
  let identity: KeyIdentity;
  try {
    const verified = verifyApiKey(token);
    identity = verified.identity;
  } catch (error) {
    // TokenExpiredError or JsonWebTokenError
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new SdkApiError(
        'unauthenticated',
        'This API key has expired. Create a new one from the Apps page.',
      );
    }
    throw new SdkApiError('unauthenticated', 'Invalid API key.');
  }

  // Look up the key in the database to check revocation status
  const row = await db.sdkApiKey.findUnique({
    where: { token },
    select: { id: true, userId: true, workspaceId: true, status: true, expiresAt: true },
  });

  // Same message for "no row" and "explicitly revoked": from the caller's
  // side both mean the key no longer works, and neither should let someone
  // distinguish "never existed" from "existed, someone else's."
  if (!row || row.status === REVOKED) {
    throw new SdkApiError('unauthenticated', 'Unknown or revoked API key.');
  }

  // Double-check expiry from DB row (belt and suspenders with JWT exp)
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new SdkApiError(
      'unauthenticated',
      'This API key has expired. Create a new one from the Apps page.',
    );
  }

  // Verify identity matches the row
  if (identity.sub !== row.userId || identity.workspaceId !== row.workspaceId) {
    logger.error('[sdk] api key identity mismatch', { keyId: row.id });
    throw new SdkApiError('unauthenticated', 'API key could not be verified.');
  }

  // Fetch user roles
  const [user, orgMember] = await Promise.all([
    db.user.findUnique({
      where: { id: identity.sub },
      select: { role: true, displayName: true },
    }),
    db.orgMember.findUnique({
      where: { memberId: identity.memberId },
      select: { role: true },
    }),
  ]);

  // The key is valid but the principal is gone (deactivated user, removed org
  // membership). Fail closed rather than proceeding without a role.
  if (!user || !orgMember) {
    logger.warn('[sdk] api key valid but principal missing', {
      keyId: row.id,
      sub: identity.sub,
      userExists: !!user,
      orgMemberExists: !!orgMember,
    });
    throw new SdkApiError('unauthenticated', 'The account for this key is no longer active.');
  }

  const authData: AuthData = {
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    displayName: user.displayName,
    workspaceId: identity.workspaceId,
    orgId: identity.orgId,
    memberId: identity.memberId,
    role: user.role,
    orgRole: orgMember.role,
  };

  req.sdkAuth = {
    authData,
    ctx: {
      userID: authData.sub,
      workspaceId: authData.workspaceId,
      role: authData.role,
      orgRole: authData.orgRole,
      memberId: authData.memberId,
    } as Context,
    keyId: row.id,
    keyExpiresAt: row.expiresAt,
  };
}

/**
 * Authenticate an SSO JWT token (`xyne_sso_...`) and attach the acting principal as `req.sdkAuth`.
 */
async function authenticateSsoJwt(req: Request, token: string): Promise<void> {
  // Verify the JWT
  let payload: SdkJwtPayload;
  try {
    payload = sdkJwtService.verifyToken(token);
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      throw new SdkApiError(
        'unauthenticated',
        'This SSO token has expired. Please re-authenticate.',
      );
    }
    throw new SdkApiError('unauthenticated', 'Invalid SSO token.');
  }

  // Fetch user roles from database
  const [user, orgMember] = await Promise.all([
    db.user.findUnique({
      where: { id: payload.sub },
      select: { role: true, displayName: true },
    }),
    db.orgMember.findUnique({
      where: { memberId: payload.memberId },
      select: { role: true },
    }),
  ]);

  // The token is valid but the principal is gone
  if (!user || !orgMember) {
    logger.warn('[sdk] sso jwt valid but principal missing', {
      sub: payload.sub,
      jti: payload.jti,
      userExists: !!user,
      orgMemberExists: !!orgMember,
    });
    throw new SdkApiError('unauthenticated', 'The account for this token is no longer active.');
  }

  const authData: AuthData = {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    displayName: payload.displayName ?? user.displayName,
    workspaceId: payload.workspaceId,
    orgId: payload.orgId,
    memberId: payload.memberId,
    role: user.role,
    orgRole: orgMember.role,
  };

  req.sdkAuth = {
    authData,
    ctx: {
      userID: authData.sub,
      workspaceId: authData.workspaceId,
      role: authData.role,
      orgRole: authData.orgRole,
      memberId: authData.memberId,
    } as Context,
    // SSO tokens don't have a key row, use jti as identifier
    keyId: payload.jti,
    keyExpiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

/**
 * SDK authentication middleware.
 *
 * Accepts both API keys (`xyne_sk_...`) and SSO JWTs (`xyne_sso_...`).
 * Attaches the authenticated principal to `req.sdkAuth`.
 */
export function apiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  (async () => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new SdkApiError(
        'unauthenticated',
        'Provide an Authorization: Bearer <api key> header.',
      );
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new SdkApiError('unauthenticated', 'Provide an Authorization: Bearer <api key> header.');
    }

    // Route to appropriate auth method based on token prefix
    if (token.startsWith(SDK_SSO_TOKEN_PREFIX)) {
      await authenticateSsoJwt(req, token);
    } else if (token.startsWith(API_KEY_PREFIX)) {
      await authenticateApiKey(req, token);
    } else {
      throw new SdkApiError('unauthenticated', 'Malformed API key or token.');
    }

    next();
  })().catch(next);
}

// Re-export types for convenience
export type { SdkAuth };
