import { Redis } from "ioredis";
import { GoogleAuth } from "google-auth-library";
import { createLogger } from "./logger.js";

const log = createLogger("redis-iam-auth");

// Memorystore IAM auth: the password is a short-lived access token, so fetch a fresh one on every (re)connect.
if (process.env["REDIS_IAM_AUTH"] === "true") {
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const connect = Redis.prototype.connect;
  Redis.prototype.connect = async function (this: Redis, ...args: Parameters<typeof connect>) {
    // ioredis sets `condition` inside connect(); commands queued while we await the token need it.
    (this as unknown as { condition?: object }).condition ??= { select: this.options.db, subscriber: false };
    this.options.password = (await auth.getAccessToken().catch((error: Error) => {
      log.error("failed to fetch IAM access token", error.message);
    })) ?? undefined;
    return connect.apply(this, args);
  } as typeof connect;
}
