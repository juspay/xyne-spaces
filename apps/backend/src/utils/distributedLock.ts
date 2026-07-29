import { randomUUID } from 'crypto';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

/**
 * Redis-backed distributed lock (single-instance-safe AND multi-instance-safe).
 *
 * Uses `SET key token EX ttl NX` to acquire and an atomic compare-and-delete
 * (Lua) to release, so a lock is only ever released by the caller that holds it.
 * A TTL bounds how long a crashed holder can wedge the lock.
 */

export interface LockHandle {
  key: string;
  token: string;
}

export interface AcquireLockOptions {
  /** Auto-expiry so a crashed/hung holder can't wedge the lock forever. Default 180s. */
  ttlSeconds?: number;
  /** Max time to wait for a held lock before giving up. 0 = try once, don't wait. Default 0. */
  waitTimeoutMs?: number;
  /** Poll interval while waiting for a held lock. Default 300ms. */
  retryDelayMs?: number;
}

// Release only if we still own the key (guards against deleting a lock that already
// expired and was re-acquired by someone else).
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquire a distributed lock. Returns a {@link LockHandle} on success, or `null`
 * if the lock stayed held by another owner for the entire wait window.
 *
 * Fails OPEN: if Redis itself errors, a handle is returned so the caller proceeds
 * *unlocked* rather than blocking all work when Redis is unavailable — a rare
 * duplicate is preferable to dropping processing entirely.
 */
export async function acquireLock(
  key: string,
  opts: AcquireLockOptions = {}
): Promise<LockHandle | null> {
  const { ttlSeconds = 180, waitTimeoutMs = 0, retryDelayMs = 300 } = opts;
  const token = randomUUID();
  const deadline = Date.now() + waitTimeoutMs;

  for (;;) {
    try {
      const acquired = await redisService.set(key, token, ttlSeconds, true); // EX ttl NX
      if (acquired) return { key, token };
    } catch (err) {
      logger.warn('[distributedLock] acquire_error_failing_open', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return { key, token }; // proceed unlocked
    }

    if (Date.now() >= deadline) return null;
    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())));
  }
}

/** Release a lock previously acquired via {@link acquireLock}. No-op for `null`. */
export async function releaseLock(handle: LockHandle | null): Promise<void> {
  if (!handle) return;
  try {
    await redisService.getClient().eval(RELEASE_LUA, 1, handle.key, handle.token);
  } catch (err) {
    logger.warn('[distributedLock] release_error', {
      key: handle.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
