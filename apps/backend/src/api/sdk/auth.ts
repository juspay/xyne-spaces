/**
 * API-key authentication for /api/sdk.
 *
 * The key *is* the credential and carries the caller's identity: it is minted
 * from the dashboard, presented as a bearer token, and accepted until it expires
 * or is deleted. Keys are short-lived by design — a key grants everything its
 * user can do and there is no refresh step, so its lifetime is the only bound on
 * one that leaks. `sdkConfig.apiKey.ttlDays` sets the default.
 *
 * ## What a key contains
 *
 * `xyne_sk_` + base64url( AES-256-CBC( JSON of the stable identity ) ), where the
 * stable identity is the subset of `AuthData` that does not change:
 *
 *     { sub, email, name, workspaceId, orgId, memberId }
 *
 * `workspaceId` is not a per-request choice. A `User` row is itself scoped to one
 * workspace — somebody with access to two holds two user rows — so `sub` already
 * determines the workspace, and Zero's `Context` carries exactly one. A key
 * therefore acts in one workspace, and a second workspace needs its own key.
 *
 * `role` and `orgRole` are deliberately excluded. They drive the mutator ACL, so
 * they are re-read from the database on every request — a demoted or deactivated
 * user loses access immediately rather than when someone remembers to delete
 * their key. `extractAuthDataFromJWT` resolves them the same way for session
 * callers. Expiry lives on the row for the same reason: both are facts that can
 * change after the key was handed out.
 *
 * ## Where integrity comes from
 *
 * Not from the cipher. `encryptionService` is AES-CBC with no MAC, so ciphertext
 * is malleable and a decrypt "succeeding" proves nothing. Authentication is the
 * exact-match lookup of the presented key against `sdk_api_keys.token`, which is
 * `@unique`: a forged or tampered key matches no row and is rejected before any
 * field inside it is trusted. The same lookup is the revocation point.
 *
 * The result is an `AuthData` identical in shape to the one the app builds from a
 * session JWT, which is why the query, mutation, and direct-API paths can hand it
 * straight to `createMutators` / `wrapTransactionWithACL` with no adaptation.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Context } from '@xyne/shared';
import type { AuthData } from '@/zero/mutators';
import { db } from '@/database/client';
import { decrypt, encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { sdkConfig } from './config';
import { ApiError } from './errors';

/** Prefix that makes a leaked key greppable in logs and repositories. */
export const API_KEY_PREFIX = 'xyne_sk_';

/** The identity sealed into a key. Everything else is resolved per request. */
export interface KeyIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly orgId: string;
  readonly memberId: string;
}

export interface SdkAuth {
  readonly authData: AuthData;
  readonly ctx: Context;
  readonly keyId: string;
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
 * Mint a key string for an identity.
 *
 * Exported for the key-management routes; nothing else should call it. The
 * caller is responsible for persisting the returned string as `token`, because
 * it cannot be re-derived — `encrypt` uses a random IV, so encrypting the same
 * identity twice yields two different keys.
 */
export function mintApiKey(identity: KeyIdentity): string {
  const sealed = encrypt(JSON.stringify(identity));
  return `${API_KEY_PREFIX}${Buffer.from(sealed, 'utf8').toString('base64url')}`;
}

/** When a key minted now should stop working. */
export function apiKeyExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + sdkConfig.apiKey.ttlDays * 24 * 60 * 60 * 1000);
}

/** Recover the identity from a key string, or undefined if it is not readable. */
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

/**
 * Authenticate an API key and attach the acting principal.
 *
 * An expired key is reported as such, since the caller can act on that. Every
 * other failure returns the same `unauthenticated` error: distinguishing "no such
 * key" from "key for a deleted user" would let a caller probe which keys exist.
 */
export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('Authorization');
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new ApiError(
        'unauthenticated',
        'Provide an Authorization: Bearer <api key> header.',
      );
    }

    const presented = header.slice(7).trim();
    if (!presented.startsWith(API_KEY_PREFIX)) {
      throw new ApiError('unauthenticated', 'Malformed API key.');
    }

    // Authenticate on the stored row, not on the decrypt. See the header note.
    const row = await db.sdkApiKey.findUnique({
      where: { token: presented },
      select: { id: true, userId: true, workspaceId: true, expiresAt: true },
    });
    if (!row) {
      throw new ApiError('unauthenticated', 'Unknown or revoked API key.');
    }

    // Distinct from `unauthenticated`: the key was genuinely issued and simply
    // ran out, which the caller fixes by minting a new one rather than by
    // hunting for a mistake in how they sent it.
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
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
      throw new ApiError('unauthenticated', 'API key could not be read.');
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
      throw new ApiError('unauthenticated', 'The account for this key is no longer active.');
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
    };

    next();
  } catch (err) {
    next(err);
  }
}
