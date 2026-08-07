/**
 * Authorization code management for SDK OAuth.
 *
 * Authorization codes are short-lived (10 min), one-time codes that the SDK
 * exchanges for an access + refresh token pair.
 */

import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/database/client';
import { oauthConfig } from './config';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'sdk-oauth-authz' });

export const AUTH_CODE_PREFIX = 'xyne_ac_';

function hashCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface IssuedAuthorizationCode {
  readonly code: string;
  readonly expiresAt: Date;
}

export async function issueAuthorizationCode(input: {
  userId: string;
  workspaceId: string;
  memberId: string;
  clientId: string;
  scopes: readonly string[];
  redirectUri?: string;
  codeChallenge: string;
}): Promise<IssuedAuthorizationCode> {
  const raw = `${AUTH_CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + oauthConfig.authCodeTtlSeconds * 1000);

  await db.sdkAuthorizationCode.create({
    data: {
      codeHash: hashCode(raw),
      userId: input.userId,
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      clientId: input.clientId,
      scopes: [...input.scopes],
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt,
    },
  });

  log.info({
    msg: 'issued authorization code',
    userId: input.userId,
    clientId: input.clientId,
    expiresAt,
  });

  return { code: raw, expiresAt };
}

export type ConsumeCodeResult =
  | {
      ok: true;
      userId: string;
      workspaceId: string;
      memberId: string;
      clientId: string;
      scopes: string[];
      redirectUri: string | null;
    }
  | {
      ok: false;
      reason:
        | 'invalid'
        | 'expired'
        | 'already_used'
        | 'client_mismatch'
        | 'redirect_mismatch'
        | 'pkce_mismatch';
    };

/**
 * Consume an authorization code (single-use).
 *
 * Validates that the code exists, hasn't been used, hasn't expired,
 * and matches the provided client_id and redirect_uri.
 */
export async function consumeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri?: string,
  codeVerifier?: string,
): Promise<ConsumeCodeResult> {
  const codeHash = hashCode(code);
  const row = await db.sdkAuthorizationCode.findUnique({ where: { codeHash } });

  if (!row) {
    return { ok: false, reason: 'invalid' };
  }

  if (row.usedAt) {
    log.warn({
      msg: 'authorization code reuse attempted',
      userId: row.userId,
      clientId: row.clientId,
    });
    return { ok: false, reason: 'already_used' };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  if (row.clientId !== clientId) {
    return { ok: false, reason: 'client_mismatch' };
  }

  // If a redirect_uri was registered with the code, it must match
  if (row.redirectUri && row.redirectUri !== redirectUri) {
    return { ok: false, reason: 'redirect_mismatch' };
  }

  if (
    row.codeChallengeMethod !== 'S256' ||
    !codeVerifier ||
    !isValidCodeVerifier(codeVerifier) ||
    challengeFor(codeVerifier) !== row.codeChallenge
  ) {
    return { ok: false, reason: 'pkce_mismatch' };
  }

  // Claim the code atomically so concurrent exchanges cannot both succeed.
  const claimed = await db.sdkAuthorizationCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'already_used' };

  return {
    ok: true,
    userId: row.userId,
    workspaceId: row.workspaceId,
    memberId: row.memberId,
    clientId: row.clientId,
    scopes: row.scopes,
    redirectUri: row.redirectUri,
  };
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}

/** Clean up expired authorization codes. Call periodically via cron. */
export async function cleanupExpiredCodes(): Promise<number> {
  const result = await db.sdkAuthorizationCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    log.info({ msg: 'cleaned up expired authorization codes', count: result.count });
  }
  return result.count;
}
