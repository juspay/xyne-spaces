/**
 * Weekly usage-pattern sync, the ENQUEUE stage of the two-stage fan-out.
 *
 * Once a week a single leader-locked pod selects the agents that actually have
 * runs in the window and enqueues one synthesis job per agent onto the
 * `usage-pattern-sync` queue. It does no LLM work itself, exactly like
 * dailyBriefCron: the bounded worker drains the queue so a fleet-wide fan-out
 * never rate-limits the provider.
 *
 * Weekly rather than daily because the artifact is a description of how an
 * agent is used, and that does not move day to day. Weekly against a 30-day
 * window also means each pass sees a corpus large enough to clear the
 * aggregation thresholds, which a 24-hour window rarely does.
 *
 * Checked on an interval rather than armed as one long timer. A seven-day
 * setTimeout is lost to every deploy, and a fleet that happens to restart on
 * the sync morning would then skip the week entirely; the interval plus a
 * week-scoped leader lock catches up instead, and still runs exactly once.
 */

import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { CONFIG } from "../config.js";
import { acquireCronLeaderLock, releaseCronLeaderLock } from "../lib/cron-leader-lock.js";
import { enqueueUsagePatternSync } from "../queue/usage-pattern-queue.js";
import { prisma } from "../db.js";
import { activeAgents } from "./usage-patterns/roster.js";
import { isWeeklySlotDue, weekBucket } from "./usage-patterns/schedule.js";

const log = createLogger("usage-pattern-cron");

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_MS = Number(process.env["USAGE_PATTERN_CRON_CHECK_MS"] ?? 6 * 60 * 60 * 1000);
/** Covers the rest of the week. The key is week-scoped anyway, so the next
 *  week's lock is a different key and cannot be blocked by this one. */
const LOCK_TTL_MS = 7 * DAY_MS;

let timer: ReturnType<typeof setInterval> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** Fleet-wide enqueue for one ISO week. Exported so the check can be driven
 *  from a test or a one-off script without waiting for the interval. */
export async function enqueueWeeklySync(bucket: string): Promise<{ enqueued: number; duplicates: number; considered: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - CONFIG.usagePatternWindowDays * DAY_MS);

  // Scanned one org at a time on purpose. agent_runs has no index that a bare
  // startedAt range can use, but it does have (orgId, startedAt); an unscoped
  // sweep is a sequential scan of the whole table, and this runs against the
  // same database serving live traffic. The org list comes from the agent
  // table, which is small.
  const orgs = await prisma.agent.findMany({ distinct: ["orgId"], select: { orgId: true }, orderBy: { orgId: "asc" } });

  const selected: Array<{ orgId: string; agentSlug: string }> = [];
  let considered = 0;
  let dropped = 0;
  let callerRuns = 0;
  for (const { orgId } of orgs) {
    const roster = await activeAgents({
      window: { start, end },
      orgId,
      minRuns: CONFIG.usagePatternMinRuns,
      limit: CONFIG.usagePatternMaxPerWeek,
    });
    selected.push(...roster.agents);
    considered += roster.considered;
    dropped += roster.droppedByLimit;
    callerRuns += roster.callerRunsScanned;
  }

  log.info(
    `[usage-pattern-cron] ${bucket}: ${selected.length} of ${considered} agent(s) across ${orgs.length} org(s) have ` +
      `enough runs in the last ${CONFIG.usagePatternWindowDays}d (scanned ${callerRuns} caller run(s))` +
      (dropped > 0 ? `, ${dropped} over the weekly cap and NOT run` : ""),
  );

  let enqueued = 0;
  let duplicates = 0;
  for (const agent of selected) {
    try {
      const result = await enqueueUsagePatternSync({
        orgId: agent.orgId,
        agentSlug: agent.agentSlug,
        windowDays: CONFIG.usagePatternWindowDays,
        bucket,
        trigger: "weekly",
      });
      if (result === "enqueued") enqueued++;
      else duplicates++;
    } catch (err) {
      log.warn(`[usage-pattern-cron] failed to enqueue ${agent.agentSlug}: ${errMsg(err)}`);
    }
  }

  log.info(`[usage-pattern-cron] ${bucket}: enqueued ${enqueued}, ${duplicates} already queued this week`);
  return { enqueued, duplicates, considered };
}

async function checkOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const slot = {
      day: CONFIG.usagePatternCronUtcDay,
      hour: CONFIG.usagePatternCronUtcHour,
      minute: CONFIG.usagePatternCronUtcMinute,
    };
    if (!isWeeklySlotDue(now, slot)) return;

    const bucket = weekBucket(now);
    // Week-scoped: one pod claims the sync for the whole week, so the six-hour
    // check cannot re-enqueue what it already enqueued on an earlier pass.
    if (!(await acquireCronLeaderLock("usage-patterns", LOCK_TTL_MS, bucket))) return;

    try {
      await enqueueWeeklySync(bucket);
    } catch (err) {
      // The lock covers a whole week, so holding it after a failed enqueue would
      // cost the week. Give it back and let the next check retry.
      log.error(`[usage-pattern-cron] ${bucket} enqueue failed: ${errMsg(err)}`);
      await releaseCronLeaderLock("usage-patterns", bucket);
    }
  } catch (err) {
    log.error(`[usage-pattern-cron] unhandled error: ${errMsg(err)}`);
  } finally {
    running = false;
  }
}

/** Call once from the API-pod boot block. */
export function initUsagePatternCron(): void {
  if (timer) return;
  if (process.env["USAGE_PATTERNS_CRON_DISABLED"] === "true") {
    log.info("[usage-pattern-cron] disabled via USAGE_PATTERNS_CRON_DISABLED");
    return;
  }
  log.info(
    `[usage-pattern-cron] initialising (slot=day ${CONFIG.usagePatternCronUtcDay} at ` +
      `${String(CONFIG.usagePatternCronUtcHour).padStart(2, "0")}:${String(CONFIG.usagePatternCronUtcMinute).padStart(2, "0")} UTC, ` +
      `check every ${CHECK_MS}ms)`,
  );
  if (CONFIG.usagePatternCronUtcDay === 0) {
    // Sunday is the LAST day of an ISO week, so a slot there has no days left
    // to catch up in: a fleet that is down at the slot loses the whole week.
    log.warn("[usage-pattern-cron] slot is Sunday, which leaves no catch-up margin; prefer a weekday");
  }
  timer = setInterval(() => { void checkOnce(); }, CHECK_MS);
  timer.unref?.();
  // Settle first: boot is already contending for Postgres and Redis, and this
  // opens with a groupBy over agent_runs. Held so shutdown can cancel it — an
  // uncancellable one fires into a torn-down queue when a pod is stopped
  // inside its first minute, which reopens the Redis connection it just closed.
  settleTimer = setTimeout(() => { settleTimer = null; void checkOnce(); }, 60_000);
  settleTimer.unref?.();
}

export function closeUsagePatternCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}
