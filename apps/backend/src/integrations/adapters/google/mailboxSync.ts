/**
 * One Gmail sync per mailbox at a time. A push that finds a sync running sets the pending
 * flag and returns; the running sync sees the flag after its round and runs another.
 */

import { acquireLock, releaseLock, renewLock } from '@/utils/distributedLock';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

const TAG = '[GmailMailboxSync]';
const LOCK_TTL_SECONDS = 60;
const LOCK_RENEW_INTERVAL_MS = 20_000;
const PENDING_TTL_SECONDS = 60 * 60;

class RedisUnavailableError extends Error {}

/** Runs `sync` for the mailbox, and again for every push that lands while a round is running. */
export async function syncMailboxSerially(sourceId: string, sync: () => Promise<void>): Promise<void> {
  const lockKey = `lock:gmail-sync:${sourceId}`;
  const pendingKey = `pending:gmail-sync:${sourceId}`;
  let rounds = 0;

  try {
    await viaRedis(() => redisService.set(pendingKey, '1', PENDING_TTL_SECONDS));
    // Re-checked after each release: a push can set the flag after our last take but before the release.
    while (await viaRedis(() => redisService.exists(pendingKey))) {
      const lock = await acquireLock(lockKey, { ttlSeconds: LOCK_TTL_SECONDS });
      if (!lock) {
        logger.info(`${TAG} [SYNC_RUNNING] another request holds this mailbox and will run again`, { sourceId });
        return;
      }
      const heartbeat = setInterval(() => void renewLock(lock, LOCK_TTL_SECONDS), LOCK_RENEW_INTERVAL_MS);
      try {
        // Take the flag before each round, so a push that lands mid-round sets it again.
        while ((await viaRedis(() => redisService.getClient().del(pendingKey))) === 1) {
          rounds++;
          await sync();
        }
      } finally {
        clearInterval(heartbeat);
        await releaseLock(lock);
      }
    }
  } catch (error) {
    if (!(error instanceof RedisUnavailableError)) throw error;
    // Fail open like acquireLock: a duplicate sync is safer than a dropped one.
    logger.warn(`${TAG} Redis unavailable — syncing without the mailbox lock`, { sourceId, error: error.message });
    if (rounds === 0) await sync();
  }
}

async function viaRedis<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new RedisUnavailableError(error instanceof Error ? error.message : String(error));
  }
}
