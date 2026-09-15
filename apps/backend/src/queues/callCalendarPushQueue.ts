/**
 * Call → Google Calendar Push Queue
 *
 * Keeps the outbound push off the request path. Scheduling, editing or
 * cancelling a call enqueues one job; the job reconciles the organizer's
 * Google Calendar with the call's current state (see callCalendarPushService).
 *
 * Because the job is a reconciler rather than a command, the jobId is
 * deterministic per call: a burst of edits collapses into one run that reads
 * the final state, and — more importantly — two workers can never both decide
 * a call has no event yet and create two. The cost of that serialisation is a
 * narrow window where an edit landing mid-run is dropped, so the processor
 * re-reads the call's revision afterwards and re-enqueues if it moved.
 *
 * Drains in the worker process only (ENABLE_CALENDAR_SYNC_WORKER, the same
 * flag as the inbound calendar sync); the API is a pure producer.
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { runAsSystem } from '@/database/tenant/context';
import { syncCallToGoogleCalendar } from '@/services/callCalendarPushService';

const TAG = '[CALENDAR_PUSH][QUEUE]';

/** Lets a burst of edits to one call coalesce into a single reconcile. */
const PUSH_COALESCE_DELAY_MS = 1_500;

type CallCalendarPushJobData = {
  callId: string;
  /** Set on the follow-up job scheduled when a call was edited mid-run. */
  isFollowUp?: boolean;
};

function pushJobId(callId: string, suffix?: string): string {
  return suffix ? `call-calendar-push-${callId}-${suffix}` : `call-calendar-push-${callId}`;
}

/**
 * Bull refuses to create a job whose id matches one sitting in a terminal
 * state that has not been removed. Our ids are deterministic per call, so a
 * single exhausted-retries failure would otherwise block that call from ever
 * pushing again. Clear the dead job before re-adding.
 */
async function clearDeadJobForReenqueue(queue: Bull.Queue, jobId: string): Promise<void> {
  try {
    const existing = await queue.getJob(jobId);
    if (!existing) return;
    if ((await existing.isFailed()) || (await existing.isCompleted())) {
      await existing.remove();
      logger.warn(`${TAG} Cleared stale job before re-enqueue`, { jobId });
    }
  } catch (err) {
    logger.warn(`${TAG} Failed to check/clear stale job before re-enqueue`, {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

class CallCalendarPushQueue {
  private queue: Bull.Queue | null = null;
  private processorRegistered = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('call-calendar-push', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  /** Producer-side setup, called in both the API and the worker. */
  async initialize(): Promise<void> {
    await this.ensureQueue();
    logger.info(`${TAG} Push queue initialized (producer)`);
  }

  /** Register the processor. Worker process only; call after initialize(). */
  async startProcessing(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.processorRegistered) return;

    // Concurrency 1: deterministic job ids already serialise per call, and a
    // single Google account is the bottleneck for every call it organizes.
    queue.process('sync-call', async (job) => {
      const { callId, isFollowUp } = job.data as CallCalendarPushJobData;
      const reconciledAt = await syncCallToGoogleCalendar(callId);
      if (!reconciledAt) return;

      // A follow-up already covers one missed edit; chaining further would
      // let a steadily-edited call re-enqueue itself indefinitely.
      if (isFollowUp) return;

      const current = await runAsSystem(() =>
        repositories.calls.findCalendarPushRevision(callId),
      );
      if (!current || current.getTime() === reconciledAt.getTime()) return;

      logger.info(`${TAG} Call changed while pushing; scheduling follow-up`, { callId });
      const followUpId = pushJobId(callId, 'followup');
      await clearDeadJobForReenqueue(queue, followUpId);
      await queue.add(
        'sync-call',
        { callId, isFollowUp: true },
        { jobId: followUpId, delay: PUSH_COALESCE_DELAY_MS },
      );
    });

    queue.on('failed', (job, err) => {
      logger.error(`${TAG} Push job failed`, {
        jobId: job.id,
        callId: job.data?.callId,
        error: err.message,
      });
    });

    this.processorRegistered = true;
    logger.info(`${TAG} Push queue processor registered`);
  }

  async enqueueSync(callId: string): Promise<void> {
    const queue = await this.ensureQueue();
    const jobId = pushJobId(callId);
    await clearDeadJobForReenqueue(queue, jobId);
    await queue.add('sync-call', { callId }, { jobId, delay: PUSH_COALESCE_DELAY_MS });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.processorRegistered = false;
    }
  }
}

export const callCalendarPushQueue = new CallCalendarPushQueue();

/**
 * Mirror a call onto the organizer's Google Calendar, in the background.
 *
 * Fire-and-forget by design: the calendar copy is a projection of the call,
 * so a Redis hiccup must never fail the scheduling request that produced it.
 */
export function queueCallCalendarPush(callId: string, context: string): void {
  void callCalendarPushQueue.enqueueSync(callId).catch((err) => {
    logger.error(`${TAG} Failed to enqueue push`, {
      callId,
      context,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Enqueue a push for several calls — a recurring series' materialized instances. */
export function queueCallCalendarPushMany(callIds: string[], context: string): void {
  for (const callId of callIds) queueCallCalendarPush(callId, context);
}
