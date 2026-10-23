/**
 * Daily sweep that keeps routing cards current for agents with a Spaces bot. Saving an
 * agent already refreshes its card; this catches edits that don't go through that save,
 * like tool changes, and cards whose generation failed.
 *
 * Self-scheduling setTimeout with the date-scoped leader lock, as digitalTwinDailyCron.ts.
 */

import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { refreshStaleRoutingCards } from "./card.js";

const log = createLogger("agent-proactivity-card-cron");

/** 19:30 UTC, 1 AM IST: clear of the memory and twin crons on the LLM gateway. */
const RUN_UTC_HOUR = 19;
const RUN_UTC_MINUTE = 30;

function scheduleNextRun(): void {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(RUN_UTC_HOUR, RUN_UTC_MINUTE, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  setTimeout(async () => {
    try {
      if (await acquireCronLeaderLock("agent-proactivity-cards")) {
        log.info("[card-cron] complete", await refreshStaleRoutingCards());
      }
    } catch (err) {
      log.error("[card-cron] failed", { err: errMsg(err) });
    } finally {
      scheduleNextRun();
    }
  }, next.getTime() - now.getTime()).unref();
}

export function initRoutingCardCron(): void {
  scheduleNextRun();
}
