/**
 * Watermark management — the exactly-once seam of the whole pipeline.
 *
 * Three invariants, each protecting against a specific way this breaks:
 *
 *  1. A window never closes at now(). Spaces reads hit a read replica, so rows
 *     written moments ago may not have replicated. Sealing at
 *     `now - replicaSafetyMs` and stepping the watermark to that same instant
 *     is what stops the cursor from stepping over unreplicated rows forever.
 *
 *  2. The watermark NEVER rewinds. It advances with a compare-and-set that
 *     only moves it forward, so two pods racing on the same agent can at worst
 *     both do the same work — never un-see events.
 *
 *  3. A failed window does NOT advance it. Skips do (the window was genuinely
 *     empty or boring, and re-reading it would produce the same skip); failures
 *     do not, so the next wake retries the same range.
 *
 * The gap guard is the backstop for the case none of the above covers: an
 * agent disabled for a week, or a pod fleet down overnight. Replaying days of
 * backlog in one window would blow the event cap and hand the model a useless
 * artifact, so the watermark jumps forward and the skip is recorded in the
 * window header where the agent can see it.
 */

import { prisma } from "../db.js";
import type { AwakeningConfig } from "./config.js";

export interface WindowBounds {
  startMs: number;
  endMs: number;
  gap: { skippedMs: number } | null;
}

/**
 * Compute the next window from a stored watermark.
 * Returns null when not enough time has passed for a non-empty window.
 */
export function sealWindow(
  watermarkAt: Date,
  config: AwakeningConfig,
  nowMs: number = Date.now(),
): WindowBounds | null {
  const endMs = nowMs - config.cursor.replicaSafetyMs;
  let startMs = watermarkAt.getTime();
  if (endMs <= startMs) return null;

  const maxSpanMs = config.periodMs * config.cursor.maxCatchupWindows;
  let gap: { skippedMs: number } | null = null;
  if (endMs - startMs > maxSpanMs) {
    const jumpedTo = endMs - maxSpanMs;
    gap = { skippedMs: jumpedTo - startMs };
    startMs = jumpedTo;
  }

  return { startMs, endMs, gap };
}

/**
 * Move the watermark forward. Compare-and-set: the UPDATE is a no-op if
 * another pod already advanced it past `toMs`, so this can never rewind.
 * Returns true when this call is the one that moved it.
 */
export async function advanceWatermark(
  agentId: string,
  toMs: number,
  lastMessageId: string | null,
): Promise<boolean> {
  const to = new Date(toMs);
  const result = await prisma.agentAwakeningState.updateMany({
    where: { agentId, watermarkAt: { lt: to } },
    data: { watermarkAt: to, watermarkMessageId: lastMessageId },
  });
  return result.count > 0;
}

/**
 * Schedule the next wake.
 *
 * Deterministic jitter derived from the agent id, not random: it spreads a
 * fleet of agents that share a period across the whole window instead of
 * stampeding on the same tick, and it stays stable across restarts so an
 * agent's beat does not wander.
 */
export function computeNextDueAt(
  agentId: string,
  config: AwakeningConfig,
  consecutiveFailures: number,
  nowMs: number = Date.now(),
): Date {
  const jitter = deterministicJitter(agentId, Math.floor(config.periodMs * 0.1));
  // Exponential backoff on repeated failure, capped so a recovered agent
  // rejoins its normal beat within one hour rather than hours later.
  const backoffFactor = consecutiveFailures > 0 ? Math.min(2 ** consecutiveFailures, 8) : 1;
  return new Date(nowMs + config.periodMs * backoffFactor + jitter);
}

/** Stable non-negative hash of the agent id, in [0, range). */
export function deterministicJitter(agentId: string, range: number): number {
  if (range <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % range;
}
