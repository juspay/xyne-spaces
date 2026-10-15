import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("oauth-refresh-lock");

const LOCK_TTL_MS = 30_000;
const WAIT_MS = 20_000;
const POLL_MS = 250;

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class OAuthRefreshBusyError extends Error {
  constructor(credKey: string) {
    super(`Another pod is still refreshing ${credKey}`);
    this.name = "OAuthRefreshBusyError";
  }
}

export async function refreshUnderLock(
  credKey: string,
  alreadyRefreshed: () => Promise<string | null>,
  refresh: () => Promise<string>,
): Promise<string> {
  const key = `claw:oauth-refresh:${credKey}`;
  const holder = `${hostname()}:${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    let acquired: boolean;
    try {
      acquired = (await redisService.getConnection().set(key, holder, "PX", LOCK_TTL_MS, "NX")) === "OK";
    } catch (err) {
      log.warn(`[oauth-refresh] ${credKey}: Redis unavailable, refreshing without a cross-pod lock:`, err instanceof Error ? err.message : err);
      return refresh();
    }
    if (acquired) {
      try {
        return (await alreadyRefreshed()) ?? (await refresh());
      } finally {
        await redisService.getConnection().eval(RELEASE_SCRIPT, 1, key, holder).catch(() => undefined);
      }
    }
    const fresh = await alreadyRefreshed();
    if (fresh) return fresh;
    if (Date.now() >= deadline) throw new OAuthRefreshBusyError(credKey);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
