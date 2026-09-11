/**
 * The live-injection inbox: how events that arrive DURING a run reach it.
 *
 * Multi-pod design note — this is a PULL, not a push.
 *
 * claw runs many pods behind one Service, and a session lives in one pod's
 * memory (`activeRuns` in xyne-claw/src/routes/run.ts is an in-process Map).
 * Pushing an injection would mean routing to the exact pod holding the
 * session, which needs pod discovery and breaks the moment the fleet scales.
 *
 * Pull costs nothing to avoid that, because of a property of the SDK: steering
 * messages are delivered only "after the current assistant turn finishes
 * executing its tool calls" (pi-agent-core types.d.ts). A pushed steer and a
 * pulled steer therefore land at exactly the same moment — the next turn
 * boundary. Pull has identical latency, needs no routing, and the pod that
 * owns the run is the one that asks.
 *
 * So: claw-auth writes batches here; the owning claw pod drains them at its own
 * turn boundaries over the same S2S boundary it already uses for session locks.
 */

import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-inbox");

/** Long enough to outlive a slow turn, short enough that a dead run's batch expires. */
const INBOX_TTL_SECONDS = 3_600;
/** Hard ceiling on queued batches, so a runaway producer cannot grow the list unbounded. */
const MAX_QUEUED_BATCHES = 20;

function inboxKey(sessionId: string): string {
  return `claw:awk:inbox:${sessionId}`;
}

function statsKey(sessionId: string): string {
  return `claw:awk:inject:${sessionId}`;
}

export interface InjectionBatch {
  /** Monotonic per session — lets the agent see it missed nothing. */
  ordinal: number;
  eventCount: number;
  /**
   * Start of the window these events came from. The reflex watermark advances
   * as soon as a batch is QUEUED, so if the run ends before draining it, this
   * is what lets the watermark be rolled back to exactly where those events
   * begin instead of stepping over them forever.
   */
  windowStartMs?: number;
  /** Rendered text handed straight to the model. */
  text: string;
  createdAtMs: number;
  /** True when this is the last injection the cap allows. */
  isFinal: boolean;
}

export interface InjectionStats {
  used: number;
  lastAtMs: number;
}

export async function readInjectionStats(sessionId: string): Promise<InjectionStats> {
  try {
    const raw = await redisService.getConnection().get(statsKey(sessionId));
    if (!raw) return { used: 0, lastAtMs: 0 };
    const parsed = JSON.parse(raw) as InjectionStats;
    return { used: Number(parsed.used) || 0, lastAtMs: Number(parsed.lastAtMs) || 0 };
  } catch {
    return { used: 0, lastAtMs: 0 };
  }
}

/**
 * Queue a batch for the running session.
 *
 * Caps are enforced by the CALLER (which knows the agent's config); this
 * function only records that an injection happened and refuses to let the list
 * grow without bound if a session stops draining.
 */
export async function pushInjection(sessionId: string, batch: InjectionBatch): Promise<boolean> {
  try {
    const redis = redisService.getConnection();
    const key = inboxKey(sessionId);
    const depth = await redis.llen(key);
    if (depth >= MAX_QUEUED_BATCHES) {
      log.warn(`[awakening] inbox full for session=${sessionId} (${depth}); dropping batch ${batch.ordinal}`);
      return false;
    }

    await redis.rpush(key, JSON.stringify(batch));
    await redis.expire(key, INBOX_TTL_SECONDS);

    const stats = await readInjectionStats(sessionId);
    await redis.set(
      statsKey(sessionId),
      JSON.stringify({ used: stats.used + 1, lastAtMs: batch.createdAtMs } satisfies InjectionStats),
      "EX",
      INBOX_TTL_SECONDS,
    );
    return true;
  } catch (err) {
    log.warn(`[awakening] inbox push failed session=${sessionId}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Atomically take everything queued for a session.
 *
 * LRANGE+DEL in a MULTI so a concurrent push is either fully included or stays
 * for the next drain — a batch can never be read and then silently discarded.
 */
export async function drainInbox(sessionId: string): Promise<InjectionBatch[]> {
  try {
    const key = inboxKey(sessionId);
    const results = await redisService.getConnection().multi().lrange(key, 0, -1).del(key).exec();
    const raw = results?.[0]?.[1] as string[] | undefined;
    if (!raw?.length) return [];

    const batches: InjectionBatch[] = [];
    for (const item of raw) {
      try {
        batches.push(JSON.parse(item) as InjectionBatch);
      } catch {
        log.warn(`[awakening] dropping unparseable inbox entry for session=${sessionId}`);
      }
    }
    return batches.sort((a, b) => a.ordinal - b.ordinal);
  } catch (err) {
    log.warn(`[awakening] inbox drain failed session=${sessionId}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Clear a finished session's inbox and counters. Best-effort. */
export async function clearInbox(sessionId: string): Promise<void> {
  try {
    await redisService.getConnection().del(inboxKey(sessionId), statsKey(sessionId));
  } catch {
    // TTLs will reap it anyway.
  }
}
