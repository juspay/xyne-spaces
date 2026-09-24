/**
 * Cluster-global concurrency gate for background LLM fan-outs.
 *
 * BullMQ `concurrency`/`limiter` are PER-WORKER-INSTANCE. A worker that runs on
 * every API replica therefore runs `concurrency × replicaCount` jobs at once,
 * which on a fleet-wide fan-out is how the LLM provider gets rate-limited. This
 * is a Redis-backed semaphore shared by ALL pods, so the concurrent-run cap
 * holds regardless of replica count.
 *
 * Implementation: a ZSET of in-flight holders scored by their expiry. Acquire is
 * an atomic Lua script that (a) drops expired holders (self-heals a crashed
 * pod's slot after `ttlMs`) and (b) adds self iff the live count is under the
 * cap. Fail-OPEN on any Redis error (same philosophy as cron-leader-lock) — a
 * Redis outage must not stop the work entirely, it just temporarily loses the
 * cap.
 *
 * Extracted from the Daily Brief gate, which is now one caller of it; the
 * usage-pattern worker is the other. Both fan out one LLM call per row of a
 * roster, which is the shape this exists for.
 */

import { hostname } from "node:os";
import { errMsg } from "./errors.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

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
function newToken(): string {
  counter = (counter + 1) % 1_000_000_000;
  return `${hostname()}:${process.pid}:${counter}:${Math.random().toString(36).slice(2)}`;
}

async function tryAcquire(key: string, cap: number, ttlMs: number, token: string, label: string): Promise<boolean> {
  try {
    const redis = redisService.getConnection();
    const r = await redis.eval(ACQUIRE_LUA, 1, key, String(Date.now()), String(cap), String(ttlMs), token);
    return r === 1;
  } catch (err) {
    // Logged under the CALLER's name, not this module's: the component field
    // is what a log search filters on, and this used to be "daily-brief-slot".
    createLogger(label).warn(`[${label}] redis acquire failed — failing OPEN: ${errMsg(err)}`);
    return true; // don't block the work during a Redis outage
  }
}

async function release(key: string, token: string): Promise<void> {
  try {
    await redisService.getConnection().zrem(key, token);
  } catch {
    // TTL will reclaim it; nothing else to do.
  }
}

export interface GlobalSlotOptions {
  /** Redis key holding this gate's in-flight set. One key per fan-out. */
  key: string;
  /** Max concurrent holders across the whole cluster. 0 disables the gate. */
  cap: number;
  /** How long to wait for a slot before giving up and throwing. */
  waitMs: number;
  /** Safety reclaim: a run should finish well inside this. A pod that dies
   *  mid-run has its slot returned after this window rather than leaking it. */
  ttlMs: number;
  /** Name used in log lines and in the thrown message. */
  label: string;
}

/**
 * Run `fn` while holding one global slot.
 *
 * Throws if no slot frees within `waitMs`, which is the point: a BullMQ job
 * that throws is retried later, so the queue absorbs the backpressure instead
 * of the provider. When `cap` is 0 the gate is disabled and `fn` runs straight
 * away.
 */
export async function withGlobalLlmSlot<T>(opts: GlobalSlotOptions, fn: () => Promise<T>): Promise<T> {
  if (!opts.cap || opts.cap <= 0) return fn();

  const token = newToken();
  const deadline = Date.now() + opts.waitMs;
  let acquired = false;
  while (Date.now() < deadline) {
    if (await tryAcquire(opts.key, opts.cap, opts.ttlMs, token, opts.label)) {
      acquired = true;
      break;
    }
    // Jittered so a pod fleet released together does not re-collide in lockstep.
    await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 500)));
  }
  if (!acquired) {
    throw new Error(`${opts.label} global LLM slot unavailable — deferring (BullMQ will retry)`);
  }
  try {
    return await fn();
  } finally {
    await release(opts.key, token);
  }
}
