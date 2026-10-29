import { Redis } from "ioredis";
import { GoogleAuth } from "google-auth-library";
import { createLogger } from "./logger.js";

const clog = createLogger("redis-iam-auth");

// Memorystore IAM auth: the password is a short-lived access token, so fetch a fresh one on every (re)connect.
if (process.env["REDIS_IAM_AUTH"] === "true") {
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
          (error: Error) => clog.error("failed to fetch IAM access token", { message: error.message }),
        )
        .then(() => connect.apply(this, args))
        .finally(() => pending.delete(this));
      pending.set(this, attempt);
    }
    return attempt;
  } as typeof connect;
}
