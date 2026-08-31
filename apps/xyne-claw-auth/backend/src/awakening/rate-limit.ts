/**
 * Per-agent run rate cap — the backstop that bounds cost when everything else
 * goes wrong (a misconfigured period, an event flood, a loop).
 *
 * Split into PEEK and CONSUME deliberately. The cap must bound runs that
 * actually happened, not wake attempts: a window that the triage gate skips
 * costs nothing, and a window that fails to dispatch delivered nothing. If
 * either burned budget, an agent in a quiet hour would rate-limit itself out
 * of the one window that mattered, and a failing agent could never retry.
 *
 * A fixed-window counter, not a sliding one: an awakened agent runs
 * single-digit times per hour, so boundary imprecision is irrelevant and it
 * costs one INCR instead of a sorted-set scan.
 *
 * FAIL-OPEN: if Redis is unreachable the wake proceeds. The tick loop already
 * bounds how often a wake can be attempted, so a Redis outage must not also
 * silence every agent.
 */

import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-rate");

/** Two hours, so the previous bucket survives long enough to be diagnosed. */
const BUCKET_TTL_SECONDS = 7_200;

function bucketKey(agentId: string, nowMs: number = Date.now()): string {
  return `claw:awk:rate:${agentId}:${Math.floor(nowMs / 3_600_000)}`;
}

export interface RateDecision {
  allowed: boolean;
  used: number;
}

/** Read the current hour's run count WITHOUT consuming budget. */
export async function peekRunRate(agentId: string, maxPerHour: number): Promise<RateDecision> {
  try {
    const raw = await redisService.getConnection().get(bucketKey(agentId));
    const used = raw ? Number(raw) : 0;
    if (!Number.isFinite(used)) return { allowed: true, used: 0 };
    if (used >= maxPerHour) {
      log.warn(`[awakening] rate cap reached agent=${agentId} used=${used} max=${maxPerHour}`);
      return { allowed: false, used };
    }
    return { allowed: true, used };
  } catch (err) {
    log.warn(`[awakening] rate peek failed (allowing) agent=${agentId}: ${err instanceof Error ? err.message : err}`);
    return { allowed: true, used: 0 };
  }
}

/** Record that a run was actually dispatched. Best-effort; never throws. */
export async function consumeRunRate(agentId: string): Promise<void> {
  try {
    const redis = redisService.getConnection();
    const key = bucketKey(agentId);
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, BUCKET_TTL_SECONDS);
  } catch (err) {
    log.warn(`[awakening] rate consume failed agent=${agentId}: ${err instanceof Error ? err.message : err}`);
  }
}
