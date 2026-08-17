import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, errors as joseErrors } from 'jose';
import type { Scope } from '@xyne/spaces-contract';
import type { AuthData } from '@/zero/mutators';
import type { Context } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiError } from '../errors';
import { oauthConfig } from '../oauth/config';
import { getPublicKey, getKeyId } from '../oauth/tokens';

export interface SdkAuth {
  readonly authData: AuthData;
  readonly ctx: Context;
  readonly scopes: readonly Scope[];
  readonly clientId: string;
  readonly tokenId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sdkAuth?: SdkAuth;
    }
  }
}

/**
 * Verify an SDK access token and build the acting principal.
 *
 * The backend is both AS and RS, so token verification uses the local public
 * key rather than fetching from an external JWKS endpoint.
 *
 * Roles are re-read from the database rather than trusted from the token.
 * A token minted before a demotion must not keep elevated access, and the
 * mutator ACL layer reads role/orgRole from this object.
 */
export async function authn(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('Authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new ApiError('unauthenticated', 'Provide an Authorization: Bearer <token> header.');
    }
    const token = header.slice(7).trim();

    // Verify that OAuth is configured before attempting verification
    if (!oauthConfig.isConfigured) {
      throw new ApiError(
        'service_misconfigured',
        'SDK OAuth is not configured; the API cannot verify access tokens.',
      );
    }

    let payload: Record<string, unknown>;
    try {
      const publicKey = getPublicKey();
      const verified = await jwtVerify(token, publicKey, {
        issuer: oauthConfig.issuer,
        audience: oauthConfig.audience,
        algorithms: ['RS256'],
      });
      payload = verified.payload as Record<string, unknown>;

      // Verify the key ID matches (defense in depth for key rotation)
      const tokenKid = verified.protectedHeader.kid;
      if (tokenKid && tokenKid !== getKeyId()) {
        logger.warn('[sdk] token kid mismatch', {
          requestId: req.apiRequestId,
          tokenKid,
          expectedKid: getKeyId(),
        });
        // Don't reject yet - the token was signed with a valid key, just maybe
        // an old one during rotation. Log for observability.
      }
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw new ApiError('token_expired', 'Access token has expired.');
      }
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError('unauthenticated', 'Access token could not be verified.', { cause: err });
    }

    const sub = asString(payload['sub']);
    const workspaceId = asString(payload['workspace_id']);
    const memberId = asString(payload['member_id']);
    const clientId = asString(payload['client_id']) ?? 'unknown';
    const tokenId = asString(payload['jti']) ?? 'unknown';
    const email = asString(payload['email']) ?? '';
    const name = asString(payload['name']) ?? '';

    if (!sub || !workspaceId || !memberId) {
      throw new ApiError('unauthenticated', 'Access token is missing required claims.');
    }

    const [user, orgMember] = await Promise.all([
      db.user.findUnique({ where: { id: sub }, select: { role: true, displayName: true } }),
      db.orgMember.findUnique({ where: { memberId }, select: { role: true } }),
    ]);

    // Token verified but the principal no longer exists (deactivated user,
    // removed org membership). Fail closed rather than proceeding role-less.
    if (!user || !orgMember) {
      logger.warn('[sdk] token valid but principal missing', {
        requestId: req.apiRequestId,
        sub,
        memberId,
        userExists: !!user,
        orgMemberExists: !!orgMember,
      });
      throw new ApiError('unauthenticated', 'The account for this token is no longer active.');
    }

    const authData: AuthData = {
      sub,
      email,
      name,
      displayName: user.displayName,
      workspaceId,
      memberId,
      role: user.role,
      orgRole: orgMember.role,
    } as AuthData;

    req.sdkAuth = {
      authData,
      ctx: {
        userID: sub,
        workspaceId,
        role: user.role,
        orgRole: orgMember.role,
        memberId,
      } as Context,
      scopes: parseScopes(payload['scope']),
      clientId,
      tokenId,
    };

    next();
  } catch (err) {
    next(err);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseScopes(raw: unknown): readonly Scope[] {
  if (typeof raw === 'string') return raw.split(' ').filter(Boolean) as Scope[];
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string') as Scope[];
  return [];
}
