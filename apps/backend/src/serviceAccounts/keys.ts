// S2S keys: `xyne_s2s_` + 256 random bits. Only the SHA-256 is stored and looked up.
import { createHash, randomBytes } from 'node:crypto';
import type { ServiceAccount, ServiceAccountKey } from '@prisma/client';
import { findServiceAccountKey, recordServiceAccountKeyUse } from '@/bypassAcl/serviceAccountServices';
import { logger } from '@/utils/logger';
import { ServiceAccountKeyStatus, ServiceAccountStatus } from './constants';
import { ServiceAccountError } from './errors';

export const KEY_PREFIX = 'xyne_s2s_';

const LAST_USED_RESOLUTION_MS = 60_000;

export function generateKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function looksLikeKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length === KEY_PREFIX.length + 43;
}

function refused(reason: 'key_invalid' | 'key_expired' | 'key_revoked', message: string): ServiceAccountError {
  return new ServiceAccountError('unauthenticated', message, { reason });
}

/** The key's service account, or `unauthenticated` if the key or account isn't usable. */
export async function authenticateKey(key: string): Promise<{ serviceAccount: ServiceAccount; keyId: string }> {
  if (!looksLikeKey(key)) throw refused('key_invalid', 'The S2S key is missing or malformed.');

  const found = await findServiceAccountKey(hashKey(key));
  if (!found) throw refused('key_invalid', 'The S2S key is not recognised.');
  const { key: row, account: serviceAccount } = found;
  if (row.status !== ServiceAccountKeyStatus.ACTIVE) throw refused('key_revoked', 'The S2S key was revoked.');
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    throw refused('key_expired', `The S2S key expired at ${row.expiresAt.toISOString()}.`);
  }

  if (!serviceAccount || serviceAccount.workspaceId !== row.workspaceId) {
    logger.error('[service-account] key points at a missing or foreign service account', { keyId: row.id });
    throw refused('key_invalid', 'The S2S key is not recognised.');
  }
  if (serviceAccount.status !== ServiceAccountStatus.ACTIVE) {
    throw refused('key_revoked', 'The service account for this key is disabled.');
  }

  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    void recordServiceAccountKeyUse(row.id, new Date(now)).catch((err) => logger.warn('[service-account] failed to record key use', { keyId: row.id, err }));
  }

  return { serviceAccount, keyId: row.id };
}

/** Tokens die with the key they were issued with: revoked or expired keys end them too. */
export function isKeyUsable(key: ServiceAccountKey | null, serviceAccountId: string): boolean {
  return (
    !!key &&
    key.serviceAccountId === serviceAccountId &&
    key.status === ServiceAccountKeyStatus.ACTIVE &&
    key.expiresAt.getTime() > Date.now()
  );
}
