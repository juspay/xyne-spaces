/**
 * Which pod runs which account. xyne-claw-auth runs several replicas, and a
 * connection-transport account (a WhatsApp Web socket) must be open on
 * EXACTLY one of them — two sockets on one WhatsApp session get both kicked.
 *
 * So each account has a renewable Redis lease. Unlike lib/cron-leader-lock.ts
 * (date-scoped, fail-open — fine for an idempotent nightly job) this lease is
 * FAIL-CLOSED: if Redis is unreachable nobody owns anything, which is the
 * safe outcome for a resource that must never be doubly held.
 *
 * Also carries the tiny control bus (Redis pub/sub) the admin API uses to
 * wake the owning pod immediately on login/logout/rebind instead of waiting
 * for the next sweep.
 */
import { hostname } from "node:os";
import type { Redis } from "ioredis";
import { redisService } from "../../redis.js";
import { createLogger } from "../../logger.js";
import { CONTROL_CHANNEL, LEASE_TTL_MS, REDIS_PREFIX } from "./const.js";

const log = createLogger("channel-placement");

const HOLDER_ID = `${hostname()}:${process.pid}`;

function leaseKey(accountId: string): string {
  return `${REDIS_PREFIX}:lease:${accountId}`;
}

const RENEW_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

function redis(): Redis {
  return redisService.getConnection();
}

export async function acquireLease(accountId: string, ttlMs = LEASE_TTL_MS): Promise<boolean> {
  try {
    const ok = await redis().set(leaseKey(accountId), HOLDER_ID, "PX", ttlMs, "NX");
    return ok === "OK";
  } catch (err) {
    log.warn(`[placement] acquire failed for ${accountId} (fail-closed):`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * "renewed" — still ours. "lost" — Redis answered and the key is gone or
 * held by someone else, so another pod is already running this account.
 * "error" — we could not ask, which says nothing about who holds it.
 *
 * The distinction is the whole point: a blip must not drop a healthy socket,
 * and a definite loss must not be waited out, because during that wait two
 * pods hold a socket for the same number and WhatsApp closes one of them.
 */
export type LeaseRenewal = "renewed" | "lost" | "error";

export async function renewLease(accountId: string, ttlMs = LEASE_TTL_MS): Promise<LeaseRenewal> {
  try {
    const result = await redis().eval(RENEW_LUA, 1, leaseKey(accountId), HOLDER_ID, String(ttlMs));
    return Number(result) === 1 ? "renewed" : "lost";
  } catch (err) {
    log.warn(`[placement] renew failed for ${accountId} (fail-closed):`, err instanceof Error ? err.message : err);
    return "error";
  }
}

export async function releaseLease(accountId: string): Promise<void> {
  try {
    await redis().eval(RELEASE_LUA, 1, leaseKey(accountId), HOLDER_ID);
  } catch (err) {
    log.warn(`[placement] release failed for ${accountId}:`, err instanceof Error ? err.message : err);
  }
}

export async function leaseHolder(accountId: string): Promise<string | null> {
  try {
    return await redis().get(leaseKey(accountId));
  } catch {
    return null;
  }
}

// ── control bus ──

export type ControlMessage =
  | { op: "login"; accountId: string }
  | { op: "logout"; accountId: string }
  | { op: "rebind"; accountId: string }
  | { op: "wake"; accountId: string };

export async function publishControl(message: ControlMessage): Promise<void> {
  try {
    await redis().publish(CONTROL_CHANNEL, JSON.stringify(message));
  } catch (err) {
    log.warn(`[placement] publish failed:`, err instanceof Error ? err.message : err);
  }
}

/** Subscribe on a dedicated connection (a subscriber connection can't run
 *  other commands). Returns a disposer. */
export function subscribeControl(handler: (message: ControlMessage) => void): () => Promise<void> {
  const sub = redis().duplicate();
  sub.on("error", (err: Error) => log.warn(`[placement] subscriber error: ${err.message}`));
  void sub.subscribe(CONTROL_CHANNEL).catch((err: unknown) =>
    log.warn(`[placement] subscribe failed:`, err instanceof Error ? err.message : err),
  );
  sub.on("message", (_channel: string, payload: string) => {
    try {
      const parsed = JSON.parse(payload) as ControlMessage;
      if (parsed && typeof parsed.accountId === "string" && typeof parsed.op === "string") handler(parsed);
    } catch {
      // ignore malformed control frames
    }
  });
  return async () => {
    await sub.quit().catch(() => undefined);
  };
}
