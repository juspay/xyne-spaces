/**
 * Four-hourly rotation of stored Slack app-configuration tokens.
 *
 * Split from config-tokens.ts so importing the token helpers (routes/apps.ts
 * does, on every request path) never drags in scheduler machinery — and so the
 * whole cron can move to the workers deployment in one piece.
 */
import { createLogger } from "../../logger.js";
import { acquireCronLeaderLock } from "../../lib/cron-leader-lock.js";
import { CONFIG_TOKEN_ROTATION_INTERVAL_MS } from "./const.js";
import { runSlackConfigTokenRotation } from "./config-tokens.js";

const log = createLogger("slack-config-token-cron");

/** Lock key bucket. Aligned to the same 4h boundaries as the timer, so exactly
 *  one replica rotates per window. */
function currentFourHourBucket(): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 4)}`;
}

function scheduleNextRotation(): void {
  const now = Date.now();
  const next =
    Math.floor(now / CONFIG_TOKEN_ROTATION_INTERVAL_MS) * CONFIG_TOKEN_ROTATION_INTERVAL_MS +
    CONFIG_TOKEN_ROTATION_INTERVAL_MS;
  const timer = setTimeout(async () => {
    try {
      const bucket = `slack-config-token-${currentFourHourBucket()}`;
      if (await acquireCronLeaderLock(bucket, CONFIG_TOKEN_ROTATION_INTERVAL_MS)) {
        await runSlackConfigTokenRotation();
      }
    } catch (error) {
      log.error("[slack-config-token] Rotation cron failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      scheduleNextRotation();
    }
  }, next - now);
  // Must not hold the process open: a referenced timer keeps the event loop
  // alive, so SIGTERM would block until this fires — up to four hours.
  timer.unref();
}

export function initSlackConfigTokenCron(): void {
  log.info("[slack-config-token] Initialising four-hour configuration token rotation");
  scheduleNextRotation();
}
