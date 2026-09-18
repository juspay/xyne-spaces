/**
 * Fire-time leader lock for the setTimeout-based nightly crons.
 *
 * xyne-claw-auth runs multiple replicas; memory-cron and digital-twin-daily
 * arm a bare setTimeout on EVERY pod, so without this guard each nightly job
 * fires once per replica (duplicate curation LLM calls, duplicate twin
 * output). Each pod computes the same fire date, so a single Redis
 * SET NX PX on a date-scoped key elects exactly one runner per job per day —
 * no renewal/leader machinery needed for a once-a-day job.
 *
 * Fail-open by design (same philosophy as the conversation lock in
 * sessions-archive.ts): if Redis is unreachable every pod proceeds, which is
 * just today's pre-lock behavior. A missed night would be worse than a
 * duplicated one — memory-cron is idempotent at the DB layer and the twin
 * daily tolerates re-runs.
 */

import { hostname } from "node:os";
import { redisService } from "../redis.js";

import { createLogger } from "../logger.js";
const log = createLogger("cron-leader-lock");

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // covers the longest plausible run; key is date-scoped anyway

const holderId = (): string => `${hostname()}:${process.pid}`;

/**
 * `scope` is the period the lock covers, defaulting to today's UTC date. A
 * weekly job passes its ISO week instead, so one pod claims the whole week
 * rather than one pod per day claiming a job that should only run once.
 */
export async function acquireCronLeaderLock(
  jobName: string,
  ttlMs = DEFAULT_TTL_MS,
  scope?: string,
): Promise<boolean> {
  const dateStr = scope ?? new Date().toISOString().slice(0, 10); // UTC fire date, identical across pods
  const key = `claw:cron-leader:${jobName}:${dateStr}`;
  const holder = holderId();
  try {
    const redis = redisService.getConnection();
    const ok = await redis.set(key, holder, "PX", ttlMs, "NX");
    if (ok !== "OK") {
      const owner = await redis.get(key).catch(() => null);
      log.info(`[cron-leader] ${jobName}: another pod is leader for ${dateStr} (${owner ?? "unknown"}) — skipping`);
      return false;
    }
    log.info(`[cron-leader] ${jobName}: acquired leadership for ${dateStr} (${holder})`);
    return true;
  } catch (err) {
    log.warn(`[cron-leader] ${jobName}: Redis unavailable, failing open (may duplicate across pods):`, err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * Hand the lock back so the next check can retry.
 *
 * Only for a run that FAILED: a daily job's key expires with the day, but a
 * weekly one holds its key for the whole week, so an enqueue that throws
 * halfway would otherwise cost the entire week with no automatic recovery.
 *
 * Deletes only if we are still the holder, so a lock that already expired and
 * was re-taken by another pod is not pulled out from under it.
 */
export async function releaseCronLeaderLock(jobName: string, scope?: string): Promise<void> {
  const dateStr = scope ?? new Date().toISOString().slice(0, 10);
  const key = `claw:cron-leader:${jobName}:${dateStr}`;
  try {
    const redis = redisService.getConnection();
    if ((await redis.get(key)) === holderId()) {
      await redis.del(key);
      log.info(`[cron-leader] ${jobName}: released ${dateStr} after a failed run`);
    }
  } catch (err) {
    log.warn(`[cron-leader] ${jobName}: release failed, the lock will expire on its own:`, err instanceof Error ? err.message : err);
  }
}
