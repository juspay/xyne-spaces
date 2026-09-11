/**
 * Cluster-global concurrency gate for Daily Brief LLM runs.
 *
 * BullMQ `concurrency`/`limiter` are PER-WORKER-INSTANCE. Since the daily-brief
 * worker runs on every API replica, per-worker concurrency alone would let the
 * fleet run `concurrency × replicaCount` briefs at once — which, on a 1000s-user
 * fan-out, can rate-limit the LLM provider. This is a Redis-backed semaphore
 * shared by ALL pods so the number of concurrent brief LLM runs is bounded
 * cluster-wide, independent of replica count.
 *
 * Implementation: a ZSET of in-flight holders scored by their expiry. Acquire is
 * an atomic Lua script that (a) drops expired holders (self-heals a crashed pod's
 * slot after SLOT_TTL_MS) and (b) adds self iff the live count is under the cap.
 * Fail-OPEN on any Redis error (same philosophy as cron-leader-lock) — a Redis
 * outage must not stop briefs entirely, it just temporarily loses the cap.
 */

import { hostname } from "node:os";
import { errMsg } from "./errors.js";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("daily-brief-slot");

const KEY = "claw:daily-brief:llm-slots";
// Safety reclaim: a brief run should finish well within this; if a pod dies
// mid-run its slot is auto-reclaimed after this window.
const SLOT_TTL_MS = 15 * 60 * 1000;

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

async function tryAcquire(cap: number, token: string): Promise<boolean> {
  try {
    const redis = redisService.getConnection();
    const r = await redis.eval(ACQUIRE_LUA, 1, KEY, String(Date.now()), String(cap), String(SLOT_TTL_MS), token);
    return r === 1;
  } catch (err) {
    log.warn(`[daily-brief-slot] redis acquire failed — failing OPEN: ${errMsg(err)}`);
    return true; // don't block briefs during a Redis outage
  }
}

async function release(token: string): Promise<void> {
  try {
    await redisService.getConnection().zrem(KEY, token);
  } catch {
    // TTL will reclaim it; nothing else to do.
  }
}

/**
 * Run `fn` while holding one global brief LLM slot. Waits up to
 * CONFIG.dailyBriefSlotWaitMs for a slot; if none frees up in that window it
 * throws so BullMQ retries the job later rather than exceeding the global cap.
 * When the cap is 0/undefined the gate is disabled and `fn` runs immediately.
 */
export async function withDailyBriefLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  const cap = CONFIG.dailyBriefGlobalConcurrency;
  if (!cap || cap <= 0) return fn();

  const token = newToken();
  const deadline = Date.now() + CONFIG.dailyBriefSlotWaitMs;
  let acquired = false;
  while (Date.now() < deadline) {
    if (await tryAcquire(cap, token)) {
      acquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 500)));
  }
  if (!acquired) {
    throw new Error("daily-brief global LLM slot unavailable — deferring (BullMQ will retry)");
  }
  try {
    return await fn();
  } finally {
    await release(token);
  }
}
