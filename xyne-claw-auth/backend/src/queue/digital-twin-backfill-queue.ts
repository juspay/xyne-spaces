/**
 * BullMQ queue for Digital Twin backfill jobs.
 *
 * One job per (user × source). jobId is keyed off `userId:source` so:
 *   - Re-enqueueing the same user+source dedups at the queue level
 *     (BullMQ refuses to add a second job with the same id).
 *   - On pod restart, an in-flight job's lock expires; another replica's
 *     worker picks it up and resumes from the cursor we persisted on
 *     User.digitalTwinBackfillState.
 *
 * The actual walking-windows-newest-to-oldest logic lives in
 * digital-twin-backfill-worker.ts.
 */

import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export type BackfillSource = "messages" | "calls" | "canvases";

export interface BackfillJobData {
  userId: string;
  source: BackfillSource;
  /** ISO date strings — earliest window the job walks back to. */
  from: string;
  /** ISO date string — most recent edge of the backfill range. */
  to: string;
}

const QUEUE_NAME = "digital-twin-backfill";

let queue: Queue<BackfillJobData> | undefined;

export function getBackfillQueue(): Queue<BackfillJobData> {
  if (!queue) {
    queue = new Queue<BackfillJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        // The curator can fail (LLM rate-limit, Spaces 5xx) — keep retrying.
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }
  return queue;
}

function jobIdFor(userId: string, source: BackfillSource): string {
  return `dt-backfill:${userId}:${source}`;
}

/**
 * Enqueue a backfill job. Returns the BullMQ job id (also serves as our own
 * external handle for status checks).
 */
export async function enqueueDigitalTwinBackfill(args: {
  userId: string;
  source: BackfillSource;
  from: Date;
  to: Date;
}): Promise<string> {
  const data: BackfillJobData = {
    userId: args.userId,
    source: args.source,
    from: args.from.toISOString(),
    to: args.to.toISOString(),
  };
  const id = jobIdFor(args.userId, args.source);
  // Remove a prior job if it exists — user re-enabling with a different
  // window means we want a fresh walk, not a resume from the old cursor.
  const existing = await getBackfillQueue().getJob(id);
  if (existing) await existing.remove();
  await getBackfillQueue().add("backfill", data, { jobId: id });
  return id;
}

/**
 * Cancel any in-flight backfill jobs for this user across all sources.
 * Called from /disable so paused users don't keep paying LLM cost on a
 * walk that will be discarded anyway.
 */
export async function cancelDigitalTwinBackfill(userId: string): Promise<number> {
  const q = getBackfillQueue();
  let removed = 0;
  for (const source of ["messages", "calls", "canvases"] as const) {
    const job = await q.getJob(jobIdFor(userId, source));
    if (job) {
      await job.remove().catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

export async function closeBackfillQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
