import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface DailyBriefJobData {
  userId: string;
}

const QUEUE_NAME = "daily-brief";

let queue: Queue<DailyBriefJobData> | undefined;

export function getDailyBriefQueue(): Queue<DailyBriefJobData> {
  if (!queue) {
    queue = new Queue<DailyBriefJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        // Keep completed jobs ~26h so the per-day jobId (`brief-<user>-<bucket>`)
        // still de-dupes a same-day re-enqueue (BullMQ only dedupes a jobId while
        // the job still exists in Redis).
        removeOnComplete: { age: 26 * 3600 },
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

/**
 * Enqueue one brief-generation job for a user. jobId is deterministic per user
 * per day so a re-enqueue (e.g. the cron double-firing across a leader-lock race)
 * is de-duplicated by BullMQ rather than generating the brief twice.
 */
export async function enqueueBriefJob(userId: string, dateBucket: string): Promise<void> {
  await getDailyBriefQueue().add(
    "generate-brief",
    { userId },
    { jobId: `brief-${userId}-${dateBucket}` },
  );
}

export const DAILY_BRIEF_QUEUE_NAME = QUEUE_NAME;

export async function closeDailyBriefQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
