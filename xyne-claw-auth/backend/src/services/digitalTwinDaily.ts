/**
 * Digital Twin daily curator — runs once per day per opt-in user.
 *
 * Self-scheduling via setTimeout, same pattern as memoryCronService.ts.
 * Fires at 2:30 AM IST (21:00 UTC, 30 minutes after the shared-memory cron
 * so the two pipelines don't compete for the LLM gateway).
 *
 * For each user with `digitalTwinEnabled=true`:
 *   1. Fetch yesterday's messages / hosted calls / authored canvases via
 *      the existing user-memory fetcher (which uses the user's own Spaces
 *      session creds).
 *   2. Pipe each source's records through the curator (batches of 40).
 *   3. Inserted candidates show up in the user's pending review queue.
 *
 * Failures (Spaces 5xx, LLM rate-limit, missing creds) are non-fatal — log
 * and move on to the next user.
 */

import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import {
  fetchUserMessages,
  fetchUserHostedCalls,
  fetchUserCanvases,
} from "./userMemoryFetcher.js";
import { curateAndPersistBatch } from "./userMemoryCuratorClient.js";

const logger = createLogger("digital-twin-daily", createTraceId());

const BATCH_SIZE = 40;

function yesterdayWindow(): { from: Date; to: Date; dateStr: string } {
  const now = new Date();
  // Yesterday 00:00 UTC → 23:59:59 UTC. Avoids the "what timezone is `today`"
  // question — UTC is the only sane choice for cross-region.
  const yest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const to = new Date(yest.getTime() + 24 * 3600 * 1000 - 1);
  const dateStr = yest.toISOString().slice(0, 10);
  return { from: yest, to, dateStr };
}

async function processUser(userId: string, window: { from: Date; to: Date; dateStr: string }): Promise<{ candidates: number }> {
  let total = 0;

  for (const [source, fetcher] of [
    ["messages", () => fetchUserMessages(userId, window)] as const,
    ["calls", () => fetchUserHostedCalls(userId, window)] as const,
    ["canvases", () => fetchUserCanvases(userId, window)] as const,
  ]) {
    let records;
    try {
      records = await fetcher();
    } catch (err) {
      logger.warn("[daily] fetch failed", { userId, source, err: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (records.length === 0) continue;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      try {
        const inserted = await curateAndPersistBatch({
          userId,
          window: { from: window.from, to: window.to },
          records: batch,
          source: `daily:${window.dateStr}:${source}`,
        });
        total += inserted;
      } catch (err) {
        logger.warn("[daily] curator batch failed", {
          userId,
          source,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { candidates: total };
}

async function runDigitalTwinDailySync(): Promise<void> {
  const window = yesterdayWindow();
  logger.info("[daily] starting", { date: window.dateStr });

  const users = await prisma.user.findMany({
    where: { digitalTwinEnabled: true },
    select: { id: true },
  });
  logger.info("[daily] opt-in users to process", { count: users.length });

  let totalCandidates = 0;
  let totalErrors = 0;
  for (const u of users) {
    try {
      const { candidates } = await processUser(u.id, window);
      totalCandidates += candidates;
    } catch (err) {
      totalErrors += 1;
      logger.error("[daily] user processing failed", {
        userId: u.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info("[daily] complete", {
    date: window.dateStr,
    users: users.length,
    totalCandidates,
    totalErrors,
  });
}

function scheduleNextRun(): void {
  const now = new Date();
  // 2:30 AM IST = 21:00 UTC the previous calendar day. We want today's 21:00 UTC.
  const nextRunUTC = new Date(now);
  nextRunUTC.setUTCHours(21, 0, 0, 0);
  if (nextRunUTC <= now) {
    nextRunUTC.setUTCDate(nextRunUTC.getUTCDate() + 1);
  }
  const msUntil = nextRunUTC.getTime() - now.getTime();
  logger.info("[daily] next run scheduled", { nextRun: nextRunUTC.toISOString(), inMs: String(msUntil) });

  setTimeout(async () => {
    try {
      // Multi-replica guard: every pod arms this timer; only the pod that wins
      // the date-scoped Redis lock actually runs the sync (cron-leader-lock.ts).
      if (await acquireCronLeaderLock("digital-twin-daily")) {
        await runDigitalTwinDailySync();
      } else {
        logger.info("[daily] skipped — another replica is running tonight's sync");
      }
    } catch (err) {
      logger.error("[daily] unhandled error", { err: err instanceof Error ? err.message : String(err) });
    } finally {
      scheduleNextRun();
    }
  }, msUntil).unref();
}

/** Call once from main.ts at startup. */
export function initDigitalTwinDaily(): void {
  if (process.env["DIGITAL_TWIN_DAILY_DISABLED"] === "true") {
    logger.info("[daily] disabled via DIGITAL_TWIN_DAILY_DISABLED");
    return;
  }
  logger.info("[daily] initialising");
  scheduleNextRun();
}
