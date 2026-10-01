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
 * The actual walking-windows-oldest-to-newest logic lives in
 * digital-twin-backfill-worker.ts.
 */

import { Queue } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import {
  BACKFILL_SOURCES,
  type BackfillJobProbe,
  type BackfillSource,
} from "../services/digitalTwinBackfillState.js";

export interface BackfillJobData {
  userId: string;
  source: BackfillSource;
  /** ISO date strings — earliest window the job walks back to. */
  from: string;
  /** ISO date string — most recent edge of the backfill range. */
  to: string;
}

export const DIGITAL_TWIN_BACKFILL_QUEUE_NAME = "digital-twin-backfill";
const BACKFILL_MAX_ATTEMPTS = 5;
/** Job states that mean a job is still progressing (prioritized stays not-live). */
const LIVE_STATES = new Set(["active", "waiting", "delayed", "waiting-children"]);

let queue: Queue<BackfillJobData> | undefined;

function getBackfillQueue(): Queue<BackfillJobData> {
  if (!queue) {
    queue = new Queue<BackfillJobData>(DIGITAL_TWIN_BACKFILL_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        // The curator can fail (LLM rate-limit, Spaces 5xx) — keep retrying.
        attempts: BACKFILL_MAX_ATTEMPTS,
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
  if (existing) {
    try {
      await existing.remove();
    } catch (err) {
      // An ACTIVE (locked) job can't be removed by BullMQ. That job is already
      // walking from the persisted cursor, so leaving it in place is exactly
      // what we want — do NOT add a duplicate (BullMQ would refuse the id
      // anyway). This is why callers guard live jobs with backfillJobIsLive
      // before enqueuing; this catch is the defensive backstop that keeps a
      // resume/enable from 500-ing on "locked by another worker".
      if (/locked by another worker/i.test(errMsg(err))) {
        return id;
      }
      throw err;
    }
  }
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
  for (const source of BACKFILL_SOURCES) {
    const job = await q.getJob(jobIdFor(userId, source));
    if (job) {
      await job.remove().catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

/** Best-effort BullMQ probe. Any error (queue down, missing job) → null. */
export async function probeBackfillJob(userId: string, source: BackfillSource): Promise<BackfillJobProbe | null> {
  try {
    const job = await getBackfillQueue().getJob(jobIdFor(userId, source));
    if (!job) return null;
    const state = await job.getState();
    return {
      state,
      attemptsMade: job.attemptsMade,
      maxAttempts: (job.opts?.attempts as number | undefined) ?? BACKFILL_MAX_ATTEMPTS,
      failedReason: job.failedReason ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * True when a live (progressing) job exists for this user+source — active,
 * waiting, delayed, or waiting-children. Used by the startup self-heal to AVOID
 * re-enqueuing a source that's already running (which would orphan the live job
 * and cause the very stall we're recovering from). A `failed`/`completed`/absent
 * job returns false → safe to re-enqueue.
 */
export async function backfillJobIsLive(userId: string, source: BackfillSource): Promise<boolean> {
  const probe = await probeBackfillJob(userId, source);
  return !!probe && LIVE_STATES.has(probe.state);
}

export async function closeBackfillQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
