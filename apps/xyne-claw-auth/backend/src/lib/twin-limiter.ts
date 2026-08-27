/**
 * Digital-twin dispatch concurrency limiter.
 *
 * Twin runs are 67% of all claw traffic (109/163 runs-per-hour measured
 * 2026-07-15) and nearly all of them execute on the shared LiteLLM key —
 * unthrottled, a busy hour of people-mentions blows straight through the
 * key's concurrent-request limit (the 429 storm of 2026-07-15, key
 * prod-key-spaces-april-2026 capped at 25 concurrent). Twin is also the one
 * workload where queueing is free: nobody is waiting on their twin's reply.
 *
 * Semantics: at most TWIN_MAX_CONCURRENT_RUNS twin runs in flight platform-
 * wide. A dispatch that can't get a slot WAITS (in-process poll with jitter,
 * up to TWIN_QUEUE_MAX_WAIT_MS) and is dropped with a log if the queue never
 * drains — twin is best-effort by design.
 *
 * Mechanics: a Redis ZSET (member = run sessionId / temp token, score =
 * acquire time). Slots are freed by the /webhook/result handler on ANY
 * terminal callback, and self-expire after TWIN_SLOT_TTL_MS so a crashed pod
 * or lost callback can never leak the capacity permanently.
 */

import { randomUUID } from "crypto";
import { errMsg } from "./errors.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("twin-limiter");

const KEY = "twin-active-runs";
const MAX_CONCURRENT = Math.max(1, Number(process.env["TWIN_MAX_CONCURRENT_RUNS"] ?? 5));
const SLOT_TTL_MS = Math.max(60_000, Number(process.env["TWIN_SLOT_TTL_MS"] ?? 15 * 60_000));
const MAX_WAIT_MS = Math.max(0, Number(process.env["TWIN_QUEUE_MAX_WAIT_MS"] ?? 8 * 60_000));
const POLL_BASE_MS = 5_000;

async function tryAcquire(token: string): Promise<boolean> {
  const redis = redisService.getConnection();
  const now = Date.now();
  // Prune expired slots first so leaked entries never wedge the semaphore.
  await redis.zremrangebyscore(KEY, "-inf", now - SLOT_TTL_MS);
  const count = await redis.zcard(KEY);
  if (count >= MAX_CONCURRENT) return false;
  await redis.zadd(KEY, now, token);
  // Post-add check closes the ZCARD→ZADD race: if an overshoot happened,
  // the LAST writers (highest scores beyond the cap) back out.
  const rank = await redis.zrank(KEY, token);
  if (rank !== null && rank >= MAX_CONCURRENT) {
    await redis.zrem(KEY, token);
    return false;
  }
  return true;
}

/**
 * Acquire a twin slot, waiting (jittered poll) up to MAX_WAIT_MS.
 * Returns a token to pass to renameTwinSlot/releaseTwinSlot, or null if the
 * queue never drained (caller should drop the dispatch with a log).
 * Fail-open on Redis errors — a broken limiter must not take the twin down.
 */
export async function acquireTwinSlot(): Promise<string | null> {
  const token = `pending:${randomUUID()}`;
  const deadline = Date.now() + MAX_WAIT_MS;
  try {
    for (;;) {
      if (await tryAcquire(token)) return token;
      if (Date.now() >= deadline) {
        log.warn(`[twin-limiter] queue wait exhausted (${MAX_WAIT_MS}ms at cap ${MAX_CONCURRENT}) — dropping twin dispatch`);
        return null;
      }
      const jitter = POLL_BASE_MS + Math.floor(Math.random() * POLL_BASE_MS);
      await new Promise((r) => setTimeout(r, jitter));
    }
  } catch (err) {
    log.warn("[twin-limiter] Redis error — failing OPEN (dispatching without a slot):", errMsg(err));
    return token; // fail-open: release becomes a no-op ZREM later
  }
}

/** Re-key a pending slot to the real run sessionId once the dispatch returns it. */
export async function renameTwinSlot(token: string, sessionId: string): Promise<void> {
  try {
    const redis = redisService.getConnection();
    await redis.zrem(KEY, token);
    await redis.zadd(KEY, Date.now(), sessionId);
  } catch (err) {
    log.warn("[twin-limiter] rename failed (slot will TTL out):", errMsg(err));
  }
}

/** Free a slot (by pending token or sessionId). Safe no-op for non-members. */
export async function releaseTwinSlot(id: string): Promise<void> {
  try {
    await redisService.getConnection().zrem(KEY, id);
  } catch {
    // TTL prune is the backstop.
  }
}
