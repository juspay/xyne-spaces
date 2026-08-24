/**
 * API-key authentication for `/api/sdk`.
 *
 * The key format, minting, and expiry live in `api/sdk/auth.ts` — this file is
 * just the Express middleware that verifies one and attaches the principal, so
 * it can be passed at the mount site the way every other route-specific auth
 * in this app is (`authMiddleware.authenticate`, `validateS2SKey`, …), rather
 * than being invisible inside the router it protects.
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
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { API_KEY_PREFIX, type KeyIdentity } from '@/api/sdk/auth';
import { SdkApiError } from '@/api/sdk/errors';

/** `sdk_api_keys.status` — see `SDK_API_KEY_STATUSES` in `api/sdk/auth.ts`. */
const REVOKED = 'REVOKED';

/**
 * Recover the identity from a key string, or undefined if it is not readable.
 *
 * Called from `apiKeyAuth` below, once the presented key has already matched a
 * `sdk_api_keys` row — decrypting is how the identity is read back, not how
 * the key is authenticated (see the header note on `apiKeyAuth`).
 */
function openApiKey(key: string): KeyIdentity | undefined {
  try {
    const sealed = Buffer.from(key.slice(API_KEY_PREFIX.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(decrypt(sealed)) as Partial<KeyIdentity>;
    if (
      !parsed.sub ||
      !parsed.workspaceId ||
      !parsed.memberId ||
      typeof parsed.email !== 'string' ||
      typeof parsed.name !== 'string'
    ) {
      return undefined;
    }
    return parsed as KeyIdentity;
  } catch {
    // Malformed base64, wrong ENCRYPTION_KEY, or not JSON. All mean "not a key
    // we issued"; the caller reports one indistinguishable failure either way.
    return undefined;
  }
}

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

    // Authenticate on the stored row, not on the decrypt. See the header note.
    const row = await db.sdkApiKey.findUnique({
      where: { token: presented },
      select: { id: true, userId: true, workspaceId: true, status: true, expiresAt: true },
    });
    // Same message for "no row" and "explicitly revoked": from the caller's
    // side both mean the key no longer works, and neither should let someone
    // distinguish "never existed" from "existed, someone else's."
    if (!row || row.status === REVOKED) {
      throw new SdkApiError('unauthenticated', 'Unknown or revoked API key.');
    }

    // Distinct from `unauthenticated`: the key was genuinely issued and simply
    // ran out, which the caller fixes by minting a new one rather than by
    // hunting for a mistake in how they sent it.
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new SdkApiError(
        'token_expired',
        'This API key has expired. Create a new one from the Apps page.',
      );
    }

    const identity = openApiKey(presented);
    if (
      !identity ||
      identity.sub !== row.userId ||
      identity.workspaceId !== row.workspaceId
    ) {
      // A stored key that will not open, or that disagrees with its own row,
      // means the encryption key was rotated or the row was tampered with.
      logger.error('[sdk] stored api key failed to open', { keyId: row.id });
      throw new SdkApiError('unauthenticated', 'API key could not be read.');
    }

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

    next();
  } catch (err) {
    next(err);
  }
}
