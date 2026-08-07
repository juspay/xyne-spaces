/**
 * Refresh token management for SDK OAuth.
 *
 * Refresh tokens are stored hashed in the database. The raw token is only
 * known to the client. Single-use rotation with family revocation on reuse.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/database/client';
import { oauthConfig } from './config';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'sdk-oauth-refresh' });

export const REFRESH_TOKEN_PREFIX = 'xyne_rt_';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface IssuedRefreshToken {
  readonly refreshToken: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export async function issueRefreshToken(input: {
  userId: string;
  workspaceId: string;
  clientId: string;
  scopes: readonly string[];
  familyId?: string;
}): Promise<IssuedRefreshToken> {
  const raw = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const familyId = input.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + oauthConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await db.sdkRefreshToken.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      familyId,
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, 12),
      scopes: [...input.scopes],
      expiresAt,
    },
  });

  log.info({
    msg: 'issued refresh token',
    userId: input.userId,
    clientId: input.clientId,
    familyId,
    expiresAt,
  });

  return { refreshToken: raw, familyId, expiresAt };
}

export type RefreshResult =
  | {
      ok: true;
      userId: string;
      workspaceId: string;
      clientId: string;
      scopes: string[];
      familyId: string;
    }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reused' };

/**
 * Consume a refresh token (single-use).
 *
 * Presenting an already-rotated token means either a replay or a stolen token
 * being used alongside the legitimate client. Both are answered the same way:
 * revoke the entire family, forcing a fresh authorization.
 */
export async function consumeRefreshToken(raw: string): Promise<RefreshResult> {
  const tokenHash = hashToken(raw);
  const row = await db.sdkRefreshToken.findUnique({ where: { tokenHash } });

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };

  if (row.rotatedAt) {
    log.warn({
      msg: 'refresh token reuse detected, revoking family',
      userId: row.userId,
      familyId: row.familyId,
    });
    await revokeFamily(row.familyId);
    return { ok: false, reason: 'reused' };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  await db.sdkRefreshToken.update({
    where: { id: row.id },
    data: { rotatedAt: new Date(), lastUsedAt: new Date() },
  });

  return {
    ok: true,
    userId: row.userId,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    scopes: row.scopes,
    familyId: row.familyId,
  };
}

export async function revokeFamily(familyId: string): Promise<number> {
  const result = await db.sdkRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revoke one refresh token. Unknown tokens are intentionally a no-op. */
export async function revokeRefreshToken(raw: string, clientId: string): Promise<void> {
  const tokenHash = hashToken(raw);
  await db.sdkRefreshToken.updateMany({
    where: { tokenHash, clientId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string, clientId?: string): Promise<number> {
  const result = await db.sdkRefreshToken.updateMany({
    where: { userId, revokedAt: null, ...(clientId ? { clientId } : {}) },
    data: { revokedAt: new Date() },
  });
  log.info({ msg: 'revoked tokens for user', userId, clientId, count: result.count });
  return result.count;
}
