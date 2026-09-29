import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { KEY_MAX_TTL_DAYS, ServiceAccountKeyStatus } from '../constants';
import { ServiceAccountError } from '../errors';
import { generateKey, hashKey } from '../keys';
import { ServiceAccountAdminPolicy, type Caller } from './access';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only time the key is returned; just its hash is stored. */
export function createKey(caller: Caller, id: string, expiresInDays: number): Promise<{ id: string; key: string; expiresAt: string }> {
  return withWorkspaceScope(async () => {
    await new ServiceAccountAdminPolicy(caller).loadManaged(id);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > KEY_MAX_TTL_DAYS) {
      throw new ServiceAccountError('validation_failed', `expiresInDays must be between 1 and ${KEY_MAX_TTL_DAYS}.`);
    }
    const key = generateKey();
    const row = await db.serviceAccountKey.create({
      data: {
        workspaceId: caller.workspaceId,
        serviceAccountId: id,
        keyHash: hashKey(key),
        status: ServiceAccountKeyStatus.ACTIVE,
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
        createdBy: caller.id,
      },
    });
    logger.info('[service-account] key created', { serviceAccountId: id, keyId: row.id, by: caller.id });
    return { id: row.id, key, expiresAt: row.expiresAt.toISOString() };
  });
}

export function revokeKey(caller: Caller, id: string, keyId: string): Promise<void> {
  return withWorkspaceScope(async () => {
    await new ServiceAccountAdminPolicy(caller).loadManaged(id);
    const key = await db.serviceAccountKey.findFirst({ where: { id: keyId, serviceAccountId: id } });
    if (!key) throw new ServiceAccountError('not_found', 'Key not found.');
    if (key.status === ServiceAccountKeyStatus.REVOKED) return;
    await db.serviceAccountKey.update({
      where: { id: keyId },
      data: { status: ServiceAccountKeyStatus.REVOKED, revokedBy: caller.id, revokedAt: new Date() },
    });
    logger.info('[service-account] key revoked', { serviceAccountId: id, keyId, by: caller.id });
  });
}
