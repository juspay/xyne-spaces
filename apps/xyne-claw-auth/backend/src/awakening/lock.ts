/**
 * One lock per agent, spanning BOTH wake kinds.
 *
 * The agent has one brain. If a heartbeat and a reflex run at the same time
 * they read overlapping windows, reach the same conclusion, and both post it —
 * the single worst failure this feature can have, and one that looks fine in
 * every log until someone reads the channel. So the lock is per AGENT, not per
 * kind, and a reflex that finds the lock held routes its events to the
 * injection inbox of the run that already holds it instead of starting a
 * second one.
 *
 * TTL-bounded with a holder token, mirroring xyne-claw/src/session-lock.ts:
 *  - the holder token is the sessionId, so only the run that took the lock can
 *    release it, and a late release from a dead run cannot free a newer one;
 *  - a pod that dies holding the lock frees it when the TTL lapses, so there is
 *    no permanently stuck agent;
 *  - it is refreshed while the run is alive so a genuinely long run is not
 *    interrupted by its own lock expiring.
 *
 * FAIL-CLOSED: if Redis is unreachable, acquisition fails and the wake is
 * skipped. A missed wake is recoverable — the watermark holds the events and
 * the next beat sees them. A double post is not.
 */

import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-lock");

/** Generous relative to a normal run; the refresh loop keeps a long one alive. */
export const AWAKENING_LOCK_TTL_MS = Number(process.env["AWAKENING_LOCK_TTL_MS"] ?? 20 * 60_000);

function lockKey(agentId: string): string {
  return `claw:awk:lock:${agentId}`;
}

export interface LockHolder {
  sessionId: string;
  kind: string;
  acquiredAtMs: number;
}

/**
 * Take the lock for `agentId`. Returns false when another run holds it, or
 * when Redis is unavailable (fail-closed).
 */
export async function acquireAgentLock(
  agentId: string,
  holder: LockHolder,
  ttlMs: number = AWAKENING_LOCK_TTL_MS,
): Promise<boolean> {
  try {
    const result = await redisService
      .getConnection()
      .set(lockKey(agentId), JSON.stringify(holder), "PX", ttlMs, "NX");
    return result === "OK";
  } catch (err) {
    log.warn(
      `[awakening] lock acquire failed for agent=${agentId} (failing closed): ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

/** Who holds the lock, or null if it is free / unreadable. */
export async function readAgentLock(agentId: string): Promise<LockHolder | null> {
  try {
    const raw = await redisService.getConnection().get(lockKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockHolder;
    return typeof parsed?.sessionId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Compare-and-delete: frees the lock only if `sessionId` still owns it.
 *
 * The check matters. Without it, a run that finished after its TTIL lapsed
 * would delete a lock a DIFFERENT run had since taken, and the two would
 * overlap — the exact failure the lock exists to prevent.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == false then return 0 end
local holder = cjson.decode(redis.call("GET", KEYS[1]))
if holder["sessionId"] == ARGV[1] then
  redis.call("DEL", KEYS[1])
  return 1
end
return 0
`;

export async function releaseAgentLock(agentId: string, sessionId: string): Promise<boolean> {
  try {
    const freed = await redisService.getConnection().eval(RELEASE_SCRIPT, 1, lockKey(agentId), sessionId);
    return freed === 1;
  } catch (err) {
    log.warn(`[awakening] lock release failed agent=${agentId}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Extend the TTL while a run is still alive. Only the holder may refresh. */
const REFRESH_SCRIPT = `
if redis.call("GET", KEYS[1]) == false then return 0 end
local holder = cjson.decode(redis.call("GET", KEYS[1]))
if holder["sessionId"] == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
`;

export async function refreshAgentLock(
  agentId: string,
  sessionId: string,
  ttlMs: number = AWAKENING_LOCK_TTL_MS,
): Promise<boolean> {
  try {
    const ok = await redisService
      .getConnection()
      .eval(REFRESH_SCRIPT, 1, lockKey(agentId), sessionId, String(ttlMs));
    return ok === 1;
  } catch {
    return false;
  }
}
