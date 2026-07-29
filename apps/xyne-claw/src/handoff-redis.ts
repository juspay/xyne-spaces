/**
 * Redis handoff signal channel — claw's ONLY direct Redis use, deliberately.
 *
 * Why this exists (owner decision, 2026-07-16): the drain-handoff signal was
 * delivered over an HTTP callback to claw-auth, and that hop failed three
 * different ways in two days —
 *   1. zero-endpoint window when both services rolled together (round 6),
 *   2. RUN_RECOVERY_PURGE_ON_START wiping state before delivery (round 5),
 *   3. a 401 from an auth-contract skew between image versions (round 7: the
 *      /sessions/:id/result fallback route turned out to be SHADOWED by the
 *      mcp router's Bearer-token middleware and had never worked at all).
 * Redis was up through every one of those incidents. The recovery worker only
 * needs the sessionId (all run state already lives in its Redis registration),
 * so the durable signal is one LPUSH with no HTTP contract, no auth
 * middleware, and no dependency on claw-auth being reachable at drain time.
 *
 * Scope guard: this client is for the handoff signal ONLY. Everything else
 * (session locks, results, progress) stays on HTTP through claw-auth — see
 * session-lock.ts for why claw otherwise holds no Redis client.
 *
 * Fail-open: if REDIS_HOST is unset or the push fails, the caller falls back
 * to the legacy HTTP callback path.
 */

import { Redis } from "ioredis";
import { createLogger } from "./logger.js";

const clog = createLogger("handoff-redis");

/** Must match HANDOFF_SIGNAL_QUEUE_KEY in claw-auth's run-recovery-worker. */
const HANDOFF_SIGNAL_QUEUE_KEY = "claw:handoff:signals";
/** Safety TTL on the list so an unconsumed backlog can't live forever. */
const QUEUE_TTL_SECONDS = 3600;

let client: Redis | null = null;
let disabled = false;

function getClient(): Redis | null {
  if (disabled) return null;
  const host = process.env["REDIS_HOST"];
  if (!host) {
    disabled = true;
    clog.warn("[handoff-redis] REDIS_HOST not set — handoff signals will use the HTTP fallback only");
    return null;
  }
  if (!client) {
    client = new Redis({
      host,
      port: Number(process.env["REDIS_PORT"] ?? 6379),
      ...(process.env["REDIS_PASSWORD"] ? { password: process.env["REDIS_PASSWORD"] } : {}),
      ...(process.env["REDIS_TLS"] ? { tls: { rejectUnauthorized: false } } : {}),
      // Drain-time posture: fail fast to the HTTP fallback instead of queueing
      // commands against a dead connection while the pod is being killed.
      connectTimeout: 3_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on("error", (err: Error) => {
      clog.warn(`[handoff-redis] connection error: ${err.message}`);
    });
  }
  return client;
}

/**
 * Push a handoff signal for the recovery worker. Returns true when the signal
 * is durably in Redis (the worker WILL consume it); false means the caller
 * must use the HTTP fallback.
 */
export async function publishHandoffSignal(sessionId: string, lastTurn: number): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.lpush(HANDOFF_SIGNAL_QUEUE_KEY, JSON.stringify({ sessionId, lastTurn, ts: Date.now() }));
    await c.expire(HANDOFF_SIGNAL_QUEUE_KEY, QUEUE_TTL_SECONDS).catch(() => undefined);
    return true;
  } catch (err) {
    clog.warn(
      `[handoff-redis] publish failed for ${sessionId} — falling back to HTTP callback: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
