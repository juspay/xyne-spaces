/**
 * Single use for Spaces event tokens (x-spaces-event): each jti is accepted once.
 * Redis is shared across replicas; when it is unavailable, a per-replica map is
 * the fallback (same trade-off as the webhook signature replay check).
 */
import { redisService } from "../redis.js";

const EVENT_REPLAY_TTL_SEC = 900;
const seen = new Map<string, number>();

/** True the first time `jti` is seen, false on a replay. */
export async function claimEventJti(jti: string): Promise<boolean> {
  try {
    const set = await redisService.getConnection().set(`spaces-event-replay:${jti}`, "1", "EX", EVENT_REPLAY_TTL_SEC, "NX");
    return set === "OK";
  } catch {
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > EVENT_REPLAY_TTL_SEC * 1000) seen.delete(k);
    if (seen.has(jti)) return false;
    seen.set(jti, now);
    return true;
  }
}
