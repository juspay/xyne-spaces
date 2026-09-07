/**
 * Multi-pod materialization ownership (KCL-style lease + fencing) for the sync engine.
 *
 * Materialization of a packing-bucket GROUP (the clientGroupID that N instances share one
 * PackConnection + one `sync:cookie` under) must run on exactly ONE pod, or two taps race the
 * shared snapshot/cookie writes. Ownership is a Redis lease with a monotonic FENCE token:
 *   - `sync:owner:{G}` = podId, SET NX PX (auto-expires → failover); heartbeated.
 *   - `sync:fence:{G}` = counter, INCR'd on every ACQUISITION → the acquirer's token. Every
 *     mutating Redis write (see redisStore) is gated on `fence == myToken`, so a paused/zombie
 *     ex-owner that wakes up cannot corrupt the data (a lease alone is unsafe — Kleppmann).
 * Interest (which instances have clients) is tracked separately, per-INSTANCE, so the owner
 * keeps materializing an instance while ANY pod wants it, even one with no local clients:
 *   - `sync:interest:{I}` = hash podId → expiryMs, TTL-pruned (manual; no per-field TTL < 7.4).
 */
import { randomUUID } from 'crypto';
import { redisService } from '@/services/redisService';

/** This process's unique id — lease ownership + interest membership are keyed by it. */
export const POD_ID = `pod-${randomUUID()}`;

const P = 'sync';
const ownerKey = (g: string): string => `${P}:owner:${g}`;
const fenceKey = (g: string): string => `${P}:fence:${g}`;
const interestKey = (i: string): string => `${P}:interest:${i}`;

export const LEASE_TTL_MS = 10_000;
export const INTEREST_TTL_MS = 15_000;

/** SET NX owner=pod PX ttl; if acquired, INCR fence → return the new token; else nil. Atomic
 *  so the token is bound to the acquisition (writing before the INCR reopens the zombie gap). */
const ACQUIRE = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('INCR', KEYS[2])
end
return nil`;

/** Extend the lease iff we still own it → 1, else 0 (we lost it → caller must demote). */
const REFRESH = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

/** Delete the lease iff we still own it (fence is left monotonic). */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/** Prune expired podIds from the interest hash, return the live count. */
const INTEREST_LIVE = `
local now = tonumber(ARGV[1])
local f = redis.call('HGETALL', KEYS[1])
local live = 0
for idx = 1, #f, 2 do
  if tonumber(f[idx + 1]) < now then
    redis.call('HDEL', KEYS[1], f[idx])
  else
    live = live + 1
  end
end
return live`;

class Ownership {
  #eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    return redisService.getClient().eval(script, numKeys, ...(args as never[]));
  }

  /** Try to become owner of group G. Returns the fence token if acquired, else null. */
  async acquireGroup(g: string): Promise<number | null> {
    const r = await this.#eval(ACQUIRE, 2, ownerKey(g), fenceKey(g), POD_ID, LEASE_TTL_MS);
    return r == null ? null : Number(r);
  }

  /** Extend our lease on G. Returns false if we no longer own it (→ demote). */
  async refreshGroup(g: string): Promise<boolean> {
    return (await this.#eval(REFRESH, 1, ownerKey(g), POD_ID, LEASE_TTL_MS)) === 1;
  }

  /** Release our lease on G (only if we still hold it). */
  async releaseGroup(g: string): Promise<void> {
    await this.#eval(RELEASE, 1, ownerKey(g), POD_ID);
  }

  /** The current owner podId of G, or null. */
  async ownerOf(g: string): Promise<string | null> {
    return redisService.getClient().get(ownerKey(g));
  }

  /** Whether THIS pod currently owns G. */
  async ownsGroup(g: string): Promise<boolean> {
    return (await this.ownerOf(g)) === POD_ID;
  }

  /** The current fence token for G (0 = never acquired). */
  async fenceOf(g: string): Promise<number> {
    return Number((await redisService.getClient().get(fenceKey(g))) ?? 0);
  }

  /** Register/refresh this pod's interest in instance I. */
  async addInterest(i: string): Promise<void> {
    await redisService.getClient().hset(interestKey(i), POD_ID, Date.now() + INTEREST_TTL_MS);
  }

  /** Drop this pod's interest in instance I. */
  async removeInterest(i: string): Promise<void> {
    await redisService.getClient().hdel(interestKey(i), POD_ID);
  }

  /** Live interest count for I across the fleet (prunes expired pods first). */
  async liveInterest(i: string): Promise<number> {
    return Number(await this.#eval(INTEREST_LIVE, 1, interestKey(i), Date.now()));
  }
}

export const ownership = new Ownership();
