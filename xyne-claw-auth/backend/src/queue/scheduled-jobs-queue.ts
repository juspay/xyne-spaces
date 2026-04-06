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

export async function enqueueCronJob(
  schedulerId: string,
  data: ScheduledJobData,
  cronExpression: string,
): Promise<string> {
  await getQueue().upsertJobScheduler(
    schedulerId,
    { pattern: cronExpression },
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
