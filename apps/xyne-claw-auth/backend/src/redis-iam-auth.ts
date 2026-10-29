import { Redis } from "ioredis";
import { GoogleAuth } from "google-auth-library";
import { CONFIG } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("redis-iam-auth");

// Memorystore IAM auth: the password is a short-lived access token, so fetch a fresh one on every (re)connect.
if (CONFIG.redisIamAuth) {
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const connect = Redis.prototype.connect;
  const pending = new WeakMap<Redis, Promise<void>>();
  Redis.prototype.connect = function (this: Redis, ...args: Parameters<typeof connect>) {
    let attempt = pending.get(this);
    if (!attempt) {
      // ioredis builds `condition` inside connect(); commands issued while we await the token need it.
      const client = this as unknown as { condition?: object };
      client.condition ??= { select: this.options.db, subscriber: false };
      attempt = auth
        .getAccessToken()
        .then(
          (token) => void (this.options.password = token ?? undefined),
          (error: Error) => log.error("failed to fetch IAM access token", error.message),
        )
        .then(() => connect.apply(this, args))
        .finally(() => pending.delete(this));
      pending.set(this, attempt);
    }
    return attempt;
  } as typeof connect;
}
