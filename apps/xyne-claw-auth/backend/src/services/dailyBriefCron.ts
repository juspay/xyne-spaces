/**
 * Daily Brief cron — the ENQUEUE stage of the two-stage fan-out.
 *
 * A single leader-locked timer fires once a day (default ~6:00 AM IST) on exactly
 * one replica, enumerates every opted-in user, and enqueues ONE brief-generation
 * job per user onto the `daily-brief` BullMQ queue. It does NO LLM work itself —
 * the bounded worker (daily-brief-worker.ts) drains the queue at a controlled
 * concurrency so a large fan-out never rate-limits the provider.
 *
 * Mirrors services/digitalTwinDaily.ts (setTimeout + cron-leader-lock), which is
 * resilient to Redis wipes (no per-user Redis scheduler to lose) — enable/disable
 * is a plain boolean column read fresh on each run.
 */

import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { enqueueBriefJob } from "../queue/daily-brief-queue.js";
import { briefDateBucket } from "./dailyBrief.js";
import { CONFIG } from "../config.js";

const log = createLogger("daily-brief-cron");

async function runEnqueue(): Promise<void> {
  const dateBucket = briefDateBucket();
  const users = await prisma.user.findMany({
    where: { dailyBriefEnabled: true },
    select: { id: true },
  });
  log.info(`[daily-brief-cron] enqueuing briefs for ${users.length} opted-in user(s) (bucket=${dateBucket})`);
  let enqueued = 0;
  for (const u of users) {
    try {
      await enqueueBriefJob(u.id, dateBucket);
      enqueued++;
    } catch (err) {
      log.warn(`[daily-brief-cron] failed to enqueue ${u.id}: ${errMsg(err)}`);
    }
  }
  log.info(`[daily-brief-cron] enqueued ${enqueued}/${users.length} brief job(s)`);
}

function scheduleNextRun(): void {
  const now = new Date();
  // Fire at CONFIG.dailyBriefCronUtcHour:MM UTC (default 00:30 UTC = 6:00 AM IST).
  const nextRunUTC = new Date(now);
  nextRunUTC.setUTCHours(CONFIG.dailyBriefCronUtcHour, CONFIG.dailyBriefCronUtcMinute, 0, 0);
  if (nextRunUTC <= now) {
    nextRunUTC.setUTCDate(nextRunUTC.getUTCDate() + 1);
  }
  const msUntil = nextRunUTC.getTime() - now.getTime();
  log.info(`[daily-brief-cron] next enqueue scheduled ${nextRunUTC.toISOString()} (in ${msUntil}ms)`);

  setTimeout(async () => {
    try {
      // Multi-replica guard: every pod arms this timer; only the pod that wins the
      // date-scoped Redis lock actually enqueues (cron-leader-lock.ts).
      if (await acquireCronLeaderLock("daily-brief")) {
        await runEnqueue();
      } else {
        log.info("[daily-brief-cron] skipped — another replica is enqueuing today");
      }
    } catch (err) {
      log.error(`[daily-brief-cron] unhandled error: ${errMsg(err)}`);
    } finally {
      scheduleNextRun();
    }
  }, msUntil).unref();
}

/** Call once from main.ts at startup (API-pod boot block). */
export function initDailyBriefCron(): void {
  if (process.env["DAILY_BRIEF_DISABLED"] === "true") {
    log.info("[daily-brief-cron] disabled via DAILY_BRIEF_DISABLED");
    return;
  }
  log.info("[daily-brief-cron] initialising");
  scheduleNextRun();
}
