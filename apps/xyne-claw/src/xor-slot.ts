/**
 * Non-blocking cluster-wide slot for XOR (Grid /v1/systemone) calls.
 *
 * The Grid key allows only 5 parallel requests across every pod of claw AND
 * claw-auth, and a saturated key makes every caller's next request fail. Both
 * services therefore share one Redis ZSET of in-flight holders, capped at
 * XOR_MAX_PARALLEL (default 4, leaving one slot of headroom). Same protocol as
 * claw-auth's lib/llm-slot.ts: holders are scored by their expiry, and an
 * atomic Lua script drops the expired ones then adds self iff the live count
 * is under the cap.
 *
 * Unlike that gate this one never waits. XOR is an accelerator in front of an
 * LLM path the caller already has, so one attempt is made and a full gate
 * answers null immediately (caller falls back) — a router turn must not queue
 * behind a fan-out. Fail-OPEN on Redis errors: an outage loses the cap, it
 * must not disable XOR. With no Redis configured the same cap is enforced
 * per process.
 */

import { hostname } from "node:os";
import { createLogger } from "./logger.js";
import { ownershipClient } from "./run-ownership.js";

const log = createLogger("xor-slot");

export const XOR_SLOT_KEY = "claw:xor:slots";
const DEFAULT_MAX_PARALLEL = 4;
const DEFAULT_CALL_TIMEOUT_MS = 2500;
/** Headroom on top of the call timeout before a crashed holder's slot is reclaimed. */
const TTL_SLACK_MS = 2000;
/** A slow Redis must not eat the caller's own (sub-second) budget. */
const ACQUIRE_TIMEOUT_MS = 300;
const WARN_INTERVAL_MS = 60_000;

// Atomic: expire stale holders, then add self iff under cap. Returns 1/0.
const ACQUIRE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local token = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now)
if redis.call('ZCARD', key) < cap then
  redis.call('ZADD', key, now + ttl, token)
  redis.call('PEXPIRE', key, ttl * 2)
  return 1
end
return 0
`;

let counter = 0;
let localInFlight = 0;
let lastWarnAt = 0;

function newToken(): string {
  counter = (counter + 1) % 1_000_000_000;
  return `${hostname()}:${process.pid}:${counter}:${Math.random().toString(36).slice(2)}`;
}

/** Cap from XOR_MAX_PARALLEL, read per call. 0 disables the gate. */
export function xorMaxParallel(): number {
  const raw = process.env["XOR_MAX_PARALLEL"]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_MAX_PARALLEL;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX_PARALLEL;
}

function warnFailOpen(err: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  log.warn(`[xor-slot] redis acquire failed — failing OPEN: ${err instanceof Error ? err.message : String(err)}`);
}

type Acquire = "acquired" | "full" | "open";

async function tryAcquire(cap: number, ttlMs: number, token: string): Promise<Acquire> {
  const redis = ownershipClient();
  if (!redis) {
    if (localInFlight >= cap) return "full";
    localInFlight += 1;
    return "acquired";
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const attempt = redis
      .eval(ACQUIRE_LUA, 1, XOR_SLOT_KEY, String(Date.now()), String(cap), String(ttlMs), token)
      .then((r) => (r === 1 ? ("acquired" as const) : ("full" as const)));
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`acquire exceeded ${ACQUIRE_TIMEOUT_MS}ms`)), ACQUIRE_TIMEOUT_MS);
    });
    // The Redis attempt may still land after the timeout; the caller's release
    // drops the token, and the TTL reclaims it otherwise.
    return await Promise.race([attempt, timedOut]);
  } catch (err) {
    warnFailOpen(err);
    return "open";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Never awaited: a slow Redis must not delay the caller's answer. */
function release(redisBacked: boolean, token: string): void {
  if (!redisBacked) {
    localInFlight = Math.max(0, localInFlight - 1);
    return;
  }
  void Promise.resolve(ownershipClient()?.zrem(XOR_SLOT_KEY, token)).catch(() => {
    // TTL will reclaim it; nothing else to do.
  });
}

export interface XorSlotOptions {
  /** The call's own timeout; the slot's safety TTL is this plus 2s. */
  timeoutMs?: number;
}

/**
 * Run `fn` while holding one XOR slot. Resolves null, without running `fn`,
 * when the cluster is already at its cap. Errors from `fn` propagate.
 */
export async function withXorSlot<T>(fn: () => Promise<T>, opts: XorSlotOptions = {}): Promise<T | null> {
  const cap = xorMaxParallel();
  if (cap === 0) return fn();

  const token = newToken();
  const ttlMs = (opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS) + TTL_SLACK_MS;
  const redisBacked = ownershipClient() !== null;
  const outcome = await tryAcquire(cap, ttlMs, token);
  if (outcome === "full") return null;
  try {
    return await fn();
  } finally {
    // "open" holds nothing in the local counter, but a Redis attempt that timed
    // out may still have written the token, so the zrem is still worth sending.
    if (outcome === "acquired" || redisBacked) release(redisBacked, token);
  }
}
