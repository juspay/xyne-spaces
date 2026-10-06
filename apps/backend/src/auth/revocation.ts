/**
 * Redis tombstones for instant JWT revocation. A revoked `auth_sessions.id` is written with
 * TTL = JWT TTL; the resolver's JWT fast path checks it when READ_MODE != legacy so a
 * cascade-revoked session stops working before its last JWT expires.
 *
 * Fail-open on Redis errors: a Redis outage must not log every user out; the DB row is still
 * REVOKED and wins as soon as the JWT expires.
 */
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { revokedSidKey } from './constants';
import type { RevocationStore } from './types';

const TOMBSTONE_VALUE = '1';

export const redisRevocationStore: RevocationStore = {
  async isRevoked(sid: string): Promise<boolean> {
    try {
      return (await redisService.get(revokedSidKey(sid))) !== null;
    } catch (error) {
      logger.warn('[AUTH] [Revocation] tombstone read failed, failing open', {
        sid,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  async markRevoked(sid: string, ttlSeconds: number): Promise<void> {
    try {
      await redisService.set(revokedSidKey(sid), TOMBSTONE_VALUE, Math.max(1, Math.ceil(ttlSeconds)));
    } catch (error) {
      logger.warn('[AUTH] [Revocation] tombstone write failed', {
        sid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
