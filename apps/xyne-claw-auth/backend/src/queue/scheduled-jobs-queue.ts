import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface ScheduledJobData {
  scheduledJobId: string;
  userId: string;
  agentSlug: string;
  task: string;
  context?: string | undefined;
  channelId?: string | undefined;
  conversationId?: string | undefined;
}

const QUEUE_NAME = "agent-scheduled-jobs";

let queue: Queue<ScheduledJobData> | undefined;

export function getQueue(): Queue<ScheduledJobData> {
  if (!queue) {
    queue = new Queue<ScheduledJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return queue;
}

export async function enqueueDelayedJob(
  data: ScheduledJobData,
  delayMs: number,
): Promise<string> {
  const job = await getQueue().add("scheduled-run", data, {
    delay: delayMs,
    jobId: `once-${data.scheduledJobId}`,
  });
  return job.id!;
}

// Cron expressions without a per-job zone are interpreted in Asia/Kolkata.
// BullMQ defaults to UTC, which previously made "0 0 * * *" fire at 5:30 AM IST
// instead of midnight IST — that was the merchant-paglu "schedule didn't
// execute" incident. Jobs created with a `timezone` (ScheduledJob.timezone, e.g.
// from the create-agent canvas) are read in that zone instead.
export const SCHEDULER_TZ = "Asia/Kolkata";

/** The zone a job's cron is read in: its own, or the Asia/Kolkata default. */
export function schedulerTimezone(timezone?: string | null): string {
  return timezone?.trim() || SCHEDULER_TZ;
}

/** True for a zone the runtime can resolve (Intl throws on unknown names). */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function enqueueCronJob(
  schedulerId: string,
  data: ScheduledJobData,
  cronExpression: string,
  timezone?: string | null,
): Promise<string> {
  await getQueue().upsertJobScheduler(
    schedulerId,
    { pattern: cronExpression, tz: schedulerTimezone(timezone) },
    { name: "cron-run", data },
  );
  return schedulerId;
}

export async function cancelJob(bullJobId: string): Promise<void> {
  const job = await getQueue().getJob(bullJobId);
  if (job) await job.remove();
}

export async function cancelCronJob(schedulerId: string): Promise<void> {
  await getQueue().removeJobScheduler(schedulerId);
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
