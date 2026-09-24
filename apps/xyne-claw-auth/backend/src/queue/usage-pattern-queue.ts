/**
 * BullMQ queue for usage-pattern synthesis, one job per agent.
 *
 * Why a queue rather than the fire-and-forget starter in the service: synthesis
 * is an LLM call per agent, and both the weekly cron and the bulk endpoint fan
 * out over the whole active roster at once. The in-process gate in
 * synthesize.ts caps concurrency by REFUSING work (`busy`), which is right for
 * a human clicking a button and wrong for a fan-out, where the work needs to be
 * remembered and drained rather than dropped. Redis remembers it; the worker
 * drains it at a bounded rate.
 *
 * Mirrors the Daily Brief pair: leader-locked cron enqueues, bounded worker
 * executes. See services/usagePatternCron.ts and usage-pattern-worker.ts.
 */

import { Queue } from "bullmq";
import { redisService } from "../redis.js";
import { usagePatternJobId } from "./usage-pattern-job-id.js";

export interface UsagePatternJobData {
  orgId: string;
  agentSlug: string;
  /** Lookback for the synthesis window, in days, ending at job start. */
  windowDays: number;
  /** The ISO week this job belongs to, echoed back in logs and status. */
  bucket: string;
  trigger: "weekly" | "manual";
  /** claw_auth user id that triggered it. Audit only. */
  requestedBy?: string;
}

export const USAGE_PATTERN_QUEUE_NAME = "usage-pattern-sync";

let queue: Queue<UsagePatternJobData> | undefined;

export function getUsagePatternQueue(): Queue<UsagePatternJobData> {
  if (!queue) {
    queue = new Queue<UsagePatternJobData>(USAGE_PATTERN_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        // Distilling fails transiently (claw rolling, LiteLLM refusing); the
        // worker rethrows that one outcome so these attempts mean something.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        // Held longer than the schedule it dedupes against. BullMQ only honours
        // a duplicate jobId while the job still exists, so a completed job must
        // outlive its own week or the next enqueue re-runs the same agent.
        removeOnComplete: { age: 8 * 24 * 3600 },
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

export { usagePatternJobId } from "./usage-pattern-job-id.js";

export type EnqueueResult = "enqueued" | "duplicate";

/**
 * Enqueue one synthesis pass.
 *
 * Returns "duplicate" when this agent already has a job for this week, which is
 * what makes a manual bulk trigger safe to run twice and safe to run in a week
 * the cron already covered. `force` replaces that job, for the case where a run
 * genuinely needs repeating.
 *
 * The old job has to be REMOVED first, not overwritten: `add` with an id that
 * already exists silently returns the existing job and keeps its data, so a
 * force that skipped the removal reported success while changing nothing.
 *
 * A job a worker currently holds cannot be removed at all, and that is reported
 * as a duplicate rather than retried: a pass is already running for this agent,
 * which is what force was asking for, and starting a second one would put two
 * writers on the same file and the same index blob.
 */
export async function enqueueUsagePatternSync(
  data: UsagePatternJobData,
  opts: { force?: boolean } = {},
): Promise<EnqueueResult> {
  const q = getUsagePatternQueue();
  const id = usagePatternJobId(data.orgId, data.agentSlug, data.bucket);

  const existing = await q.getJob(id);
  if (existing) {
    if (!opts.force) return "duplicate";
    const removed = await existing.remove().then(() => true).catch(() => false);
    if (!removed) return "duplicate";
  }
  await q.add("synthesize", data, { jobId: id });
  return "enqueued";
}

export interface UsagePatternQueueStats {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

/** Queue depth, which is what a bulk trigger polls for progress. */
export async function usagePatternQueueStats(): Promise<UsagePatternQueueStats> {
  const counts = await getUsagePatternQueue().getJobCounts(
    "waiting",
    "active",
    "delayed",
    "completed",
    "failed",
  );
  return {
    waiting: counts["waiting"] ?? 0,
    active: counts["active"] ?? 0,
    delayed: counts["delayed"] ?? 0,
    completed: counts["completed"] ?? 0,
    failed: counts["failed"] ?? 0,
  };
}

export async function closeUsagePatternQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
