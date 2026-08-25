/**
 * API-key authentication for `/api/sdk`.
 *
 * The key format, minting, and verification live in `api/sdk/auth.ts` — this
 * file is the Express middleware that calls into that and attaches the
 * principal, so it can be passed at the mount site the way every other
 * route-specific auth in this app is (`authMiddleware.authenticate`,
 * `validateS2SKey`, …), rather than being invisible inside the router it
 * protects.
 *
 * Authenticating one key takes three reads, issued together because none of
 * them depends on another's result:
 *
 *   - the `sdk_api_keys` row, which says whether the key has been revoked
 *   - `users.role` and `org_members.role`, read fresh the same way session auth
 *     does it (`extractAuthDataFromJWT`)
 *
 * The signature alone is never enough. A JWT cannot be un-issued, so a valid
 * signature only proves the key was minted here — the row is what says it is
 * still allowed, and every one of the four ways this can fail (no row, revoked
 * row, expired row, missing principal) is reported as the same
 * `unauthenticated`, so a caller learns nothing about which keys exist.
 */

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Context } from '@xyne/shared';
import type { AuthData } from '@/zero/mutators';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { verifyApiKey, API_KEY_PREFIX, SDK_API_KEY_STATUS } from '@/api/sdk/auth';
import { SdkApiError } from '@/api/sdk/errors';

/** Authenticate an API key and attach the acting principal as `req.sdkAuth`. */
export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('Authorization');
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new SdkApiError(
        'unauthenticated',
        'Provide an Authorization: Bearer <api key> header.',
      );
    }

    const presented = header.slice(7).trim();
    if (!presented.startsWith(API_KEY_PREFIX)) {
      throw new SdkApiError('unauthenticated', 'Malformed API key.');
    }

    let verified;
    try {
      verified = verifyApiKey(presented);
    } catch (err) {
      // Distinct from `unauthenticated`: the key was genuinely issued and
      // simply ran out (or was swept up by a force logout), which the caller
      // fixes by minting a new one rather than by hunting for a mistake in
      // how they sent it.
      if (err instanceof jwt.TokenExpiredError) {
        throw new SdkApiError(
          'token_expired',
          'This API key has expired. Create a new one from the Apps page.',
        );
      }
      // Bad signature, wrong audience, malformed token: all mean "not a key
      // this deployment issued," reported as one indistinguishable failure.
      throw new SdkApiError('unauthenticated', 'Invalid API key.');
    }

    const { identity } = verified;

    // One round trip, not three. None of these depends on another's result, and
    // the key row is looked up by the presented string itself — `mintApiKey`
    // returns the `xyne_sk_`-prefixed value and that is exactly what is stored.
    const [keyRow, user, orgMember] = await Promise.all([
      db.sdkApiKey.findUnique({
        where: { token: presented },
        select: { id: true, status: true, expiresAt: true },
      }),
      db.user.findUnique({
        where: { id: identity.sub },
        select: { role: true, displayName: true },
      }),
      db.orgMember.findUnique({
        where: { memberId: identity.memberId },
        select: { role: true },
      }),
    ]);

    // A signature that verifies is necessary, not sufficient: without a row
    // there is nothing that could ever revoke this key, so a missing row is a
    // reason to refuse rather than to wave through.
    if (!keyRow) {
      logger.warn('[sdk] api key verified but has no row', { sub: identity.sub });
      throw new SdkApiError('unauthenticated', 'This API key is no longer valid.');
    }

    if (keyRow.status !== SDK_API_KEY_STATUS.ACTIVE) {
      throw new SdkApiError('unauthenticated', 'This API key has been revoked.');
    }

    // Belt and braces against the token's own `exp`, which `jwt.verify` has
    // already enforced. Reading the row is what makes it authoritative for
    // both levers, so an expiry shortened here takes effect too.
    if (keyRow.expiresAt.getTime() <= Date.now()) {
      throw new SdkApiError(
        'token_expired',
        'This API key has expired. Create a new one from the Apps page.',
      );
    }

    // The key is valid but the principal is gone (deactivated user, removed org
    // membership). Fail closed rather than proceeding without a role.
    if (!user || !orgMember) {
      logger.warn('[sdk] api key valid but principal missing', {
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
      keyId: keyRow.id,
      keyExpiresAt: verified.expiresAt,
    };

    next();
  } catch (err) {
    next(err);
  }
}
