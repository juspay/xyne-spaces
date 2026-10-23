/**
 * One Gmail sync per mailbox at a time. A push that finds a sync running sets the pending
 * flag and returns; the running sync sees the flag after its round and runs another.
 * The worker's catch-up takes the same lock without handing off, and retries later when it is busy.
 */

import { acquireLock, releaseLock, renewLock } from '@/utils/distributedLock';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

const TAG = '[GmailMailboxSync]';
const LOCK_TTL_SECONDS = 60;
const LOCK_RENEW_INTERVAL_MS = 20_000;
const PENDING_TTL_SECONDS = 60 * 60;

class RedisUnavailableError extends Error {}

/**
 * Runs `sync` for the mailbox, and again for every push that lands while a round is running.
 * With `handOff: false` a busy mailbox resolves false instead, so the caller can retry its round later.
 * With `maxHoldMs`, no new round starts and the lock isn't renewed after that long; if pushes are still
 * pending, `onHoldLimit` runs to hand them on.
 */
export async function syncMailboxSerially(
  sourceId: string,
  sync: () => Promise<void>,
  {
    handOff = true,
    maxHoldMs,
    onHoldLimit,
  }: { handOff?: boolean; maxHoldMs?: number; onHoldLimit?: () => Promise<void> } = {},
): Promise<boolean> {
  const lockKey = `lock:gmail-sync:${sourceId}`;
  const pendingKey = `pending:gmail-sync:${sourceId}`;
  const startedAt = Date.now();
  const withinHold = () => maxHoldMs === undefined || Date.now() - startedAt < maxHoldMs;
  let rounds = 0;
  // Without hand-off this call's own round must run, so its first take doesn't wait on the flag.
  let ownRound = !handOff;

  try {
    if (handOff) await viaRedis(() => redisService.set(pendingKey, '1', PENDING_TTL_SECONDS));
    // Re-checked after each release: a push can set the flag after our last take but before the release.
    while (ownRound || (await viaRedis(() => redisService.exists(pendingKey)))) {
      if (!withinHold()) {
        logger.warn(`${TAG} [HOLD_LIMIT] handing the pending pushes on`, { sourceId, rounds });
        await onHoldLimit?.();
        return true;
      }
      const lock = await acquireLock(lockKey, { ttlSeconds: LOCK_TTL_SECONDS });
      if (!lock) {
        if (ownRound) return false;
        logger.info(`${TAG} [SYNC_RUNNING] another request holds this mailbox and will run again`, { sourceId });
        return true;
      }
      // Not renewed past the hold limit, so a round that hangs loses the lock.
      const heartbeat = setInterval(() => {
        if (withinHold()) void renewLock(lock, LOCK_TTL_SECONDS);
      }, LOCK_RENEW_INTERVAL_MS);
      try {
        // Set only once we hold the lock, so no other sync can take this round.
        if (ownRound) await viaRedis(() => redisService.set(pendingKey, '1', PENDING_TTL_SECONDS));
        ownRound = false;
        // Take the flag before each round, so a push that lands mid-round sets it again.
        while (withinHold() && (await viaRedis(() => redisService.getClient().del(pendingKey))) === 1) {
          rounds++;
          await sync();
        }
      } finally {
        clearInterval(heartbeat);
        await releaseLock(lock);
      }
    }
    return true;
  } catch (error) {
    if (!(error instanceof RedisUnavailableError)) throw error;
    // Fail open like acquireLock: a duplicate sync is safer than a dropped one.
    logger.warn(`${TAG} Redis unavailable — syncing without the mailbox lock`, { sourceId, error: error.message });
    if (rounds === 0) await sync();
    return true;
  }
}

async function viaRedis<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new RedisUnavailableError(error instanceof Error ? error.message : String(error));
  }
}
