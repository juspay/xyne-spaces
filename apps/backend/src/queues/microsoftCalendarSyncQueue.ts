/**
 * Microsoft Calendar Sync Queue
 *
 * Two distinct sync modes:
 *  1. FULL SYNC — Fetches next 30 days of calendarView, compares with DB, upserts all, and
 *                 cancels ones not in the window. Enqueued by user-triggered sync and by
 *                 subscription setup.
 *  2. INCREMENTAL SYNC — Triggered by webhook push. Uses deltaLink to fetch only changes
 *                        from Microsoft Graph, upserts ONLY changed events, never touches other calls.
 *
 * Both run in the worker process only (ENABLE_CALENDAR_SYNC_WORKER); the API is a
 * pure producer. There is deliberately no in-process "sync now" helper: an API-only
 * environment that synced locally would write calls rows the owning environment
 * also writes, which collides on the unique index once data moves between them.
 */

import Bull from 'bull';
import { AuthProvider } from '@xyne/shared';
import { createHash } from 'crypto';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import { runWithContext } from '@/database/tenant/context';
import {
  fetchMicrosoftEventsInRange,
  fetchMicrosoftDeltaChanges,
  fetchAllMicrosoftEventsForBaseline,
} from '@/services/microsoftCalendarApi';
import { storeMsCalEventsAsCallsForUser } from '@/services/microsoftCalendarCallStore';
import { MicrosoftCalendarSubscriptionService } from '@/services/microsoftCalendarSubscriptionService';
import {
  CALENDAR_INCREMENTAL_CONTINUATION_DELAY_MS,
  CALENDAR_SYNC_LOOKAHEAD_DAYS,
  MAX_CALENDAR_EVENTS_PER_SYNC,
} from '@/services/calendarSyncConfig';
import { calendarSyncErrorMessage, isPermanentCalendarAuthError } from './calendarSyncErrorUtils';

const TAG = '[CALENDAR_SYNC][MICROSOFT][QUEUE]';

type CalendarSyncJobData = {
  sourceId?: string;
  deltaLink?: string;
};

type MicrosoftIncrementalContinuation = {
  sourceId: string;
  deltaLink: string;
};

function continuationJobId(sourceId: string, deltaLink: string): string {
  const cursorHash = createHash('sha1').update(deltaLink).digest('hex');
  return `microsoft-calendar-incremental-${sourceId}-${cursorHash}`;
}

/**
 * Bull refuses to create a new job when a job with the same jobId already
 * exists in a terminal state (failed/completed) that hasn't been removed.
 * Since our jobIds are deterministic per sourceId (by design, to serialize
 * access to the Microsoft delta cursor), a single exhausted-retries failure
 * would otherwise permanently block every future sync for that source.
 * Clear out any dead job for this id before adding a fresh one.
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

async function resolveSourceId(jobData: CalendarSyncJobData): Promise<string> {
  if (jobData.sourceId) return jobData.sourceId;
  throw new Error(
    'Microsoft calendar sync job missing sourceId; email-based calendar jobs are not supported'
  );
}

async function performManualSync(sourceId: string): Promise<void> {
  const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.MICROSOFT);
  if (!credentials) {
    throw new Error(`No active Microsoft calendar credentials found for source ${sourceId}`);
  }

  const userId = credentials.userId;
  const user = await repositories.users.findById(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  logger.info(`${TAG} Manual sync for user ${user.email}`, { sourceId, userId });

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + CALENDAR_SYNC_LOOKAHEAD_DAYS);

  try {
    const { events, truncated } = await fetchMicrosoftEventsInRange(
      credentials.accessToken,
      now,
      future,
      MAX_CALENDAR_EVENTS_PER_SYNC
    );

    await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      storeMsCalEventsAsCallsForUser(events, userId, user.email, {
        isFullSync: true,
        timeRange: { startsAfter: now, startsBefore: future },
        skipCancelRemoved: truncated,
      })
    );

    await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, undefined, true);

    logger.info(`${TAG} Manual sync complete for user ${user.email}: ${events.length} event(s)`, {
      sourceId,
      userId,
    });
    if (truncated) {
      logger.warn(`${TAG} Manual sync hit event cap for user ${user.email}`, { sourceId, userId });
    }
  } catch (err) {
    const errorMessage = calendarSyncErrorMessage(err);
    logger.error(`${TAG} Sync failed for source ${sourceId}: ${errorMessage}`);
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`${TAG} Permanent auth failure, deactivating source ${sourceId}`);
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(
        sourceId,
        undefined,
        false
      );
    } else {
      logger.warn(`${TAG} Transient sync failure, keeping source active ${sourceId}`);
    }
    throw err;
  }
}

async function performIncrementalSync(
  sourceId: string,
  jobData: CalendarSyncJobData
): Promise<MicrosoftIncrementalContinuation | null> {
  const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.MICROSOFT);
  if (!credentials) {
    throw new Error(`No active Microsoft calendar credentials found for source ${sourceId}`);
  }

  const userId = credentials.userId;
  const user = await repositories.users.findById(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const subscription = await repositories.externalSources.findById(sourceId);

  if (!subscription?.lastSyncCursor) {
    logger.info(`${TAG} No deltaLink, establishing baseline for user ${user.email}`, {
      sourceId,
      userId,
    });

    const { events, deltaLink, truncated } = await fetchAllMicrosoftEventsForBaseline(
      credentials.accessToken,
      CALENDAR_SYNC_LOOKAHEAD_DAYS,
      MAX_CALENDAR_EVENTS_PER_SYNC
    );

    await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      storeMsCalEventsAsCallsForUser(events, userId, user.email, {
        isFullSync: true,
        skipCancelRemoved: truncated,
      })
    );
    await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, deltaLink, true);

    logger.info(`${TAG} Baseline established for user ${user.email}: ${events.length} event(s)`, {
      sourceId,
      userId,
    });
    if (truncated) {
      logger.warn(`${TAG} Baseline sync hit event cap for user ${user.email}`, {
        sourceId,
        userId,
      });
    }
    return null;
  }

  logger.info(`${TAG} Incremental sync for user ${user.email}`, { sourceId, userId });

  try {
    const deltaLink = jobData.deltaLink ?? subscription.lastSyncCursor;
    const result = await fetchMicrosoftDeltaChanges(
      credentials.accessToken,
      deltaLink,
      MAX_CALENDAR_EVENTS_PER_SYNC
    );

    if (result.needsFullSync) {
      logger.warn(`${TAG} deltaLink expired, re-establishing baseline for user ${user.email}`, {
        sourceId,
        userId,
      });

      const {
        events,
        deltaLink: newDeltaLink,
        truncated,
      } = await fetchAllMicrosoftEventsForBaseline(
        credentials.accessToken,
        CALENDAR_SYNC_LOOKAHEAD_DAYS,
        MAX_CALENDAR_EVENTS_PER_SYNC
      );

      await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
        storeMsCalEventsAsCallsForUser(events, userId, user.email, {
          isFullSync: true,
          skipCancelRemoved: truncated,
        })
      );
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(
        sourceId,
        newDeltaLink,
        true
      );

      logger.info(
        `${TAG} Baseline re-established for user ${user.email}: ${events.length} event(s)`,
        { sourceId, userId }
      );
      if (truncated) {
        logger.warn(`${TAG} Baseline re-sync hit event cap for user ${user.email}`, {
          sourceId,
          userId,
        });
      }
      return null;
    }

    await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      storeMsCalEventsAsCallsForUser(result.events, userId, user.email, { isFullSync: false })
    );

    if (result.nextLink) {
      logger.warn(`${TAG} Incremental sync hit event cap, scheduling continuation`, {
        sourceId,
      });
      return { sourceId, deltaLink: result.nextLink };
    }

    if (result.newDeltaLink) {
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(
        sourceId,
        result.newDeltaLink,
        true
      );
    }

    logger.info(
      `${TAG} Incremental sync complete for user ${user.email}: ${result.events.length} changed event(s)`,
      { sourceId, userId }
    );
    return null;
  } catch (err) {
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`${TAG} Permanent auth failure, deactivating source ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(
        sourceId,
        subscription?.lastSyncCursor,
        false
      );
    } else {
      logger.warn(`${TAG} Transient sync failure, keeping source active ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
    }
    throw err;
  }
}

async function deactivateSourceOnPermanentAuthError(sourceId: string, err: unknown): Promise<void> {
  if (!isPermanentCalendarAuthError(err)) return;

  logger.error(`${TAG} Permanent auth failure, deactivating source ${sourceId}`, {
    error: calendarSyncErrorMessage(err),
  });
  await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, undefined, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════════════════════

class MicrosoftCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private processorRegistered = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('microsoft-calendar-sync', {
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

  /**
   * Producer-side setup: connect to the queue so jobs can be enqueued.
   * Called in both the API and the worker. Deliberately registers no
   * processor — draining happens in the worker process only, via
   * startProcessing() behind ENABLE_CALENDAR_SYNC_WORKER.
   */
  async initialize(): Promise<void> {
    await this.ensureQueue();
    logger.info(`${TAG} Sync queue initialized (producer)`);
  }

  /**
   * Register the job processors. Worker process only; call after initialize().
   * The webhook route (API) enqueues; the work itself — Graph delta paging,
   * event upserts, deltaLink bookkeeping — runs here, off the request path.
   */
  async startProcessing(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.processorRegistered) return;

    queue.process('manual-sync', async (job) => {
      const sourceId = await resolveSourceId(job.data as CalendarSyncJobData);
      try {
        await performManualSync(sourceId);
      } catch (err) {
        await deactivateSourceOnPermanentAuthError(sourceId, err);
        throw err;
      }
    });

    queue.process('incremental-sync', async (job) => {
      const jobData = job.data as CalendarSyncJobData;
      const sourceId = await resolveSourceId(jobData);
      let continuation: MicrosoftIncrementalContinuation | null;
      try {
        continuation = await performIncrementalSync(sourceId, jobData);
      } catch (err) {
        await deactivateSourceOnPermanentAuthError(sourceId, err);
        throw err;
      }
      if (continuation) {
        const continuationId = continuationJobId(continuation.sourceId, continuation.deltaLink);
        await clearDeadJobForReenqueue(queue, continuationId);
        logger.info(`${TAG} Scheduling incremental continuation`, {
          sourceId: continuation.sourceId,
          delayMs: CALENDAR_INCREMENTAL_CONTINUATION_DELAY_MS,
        });
        await queue.add('incremental-sync', continuation, {
          jobId: continuationId,
          delay: CALENDAR_INCREMENTAL_CONTINUATION_DELAY_MS,
        });
      }
    });

    queue.on('failed', (job, err) => {
      logger.error(`${TAG} Sync job failed`, {
        jobName: job.name,
        jobId: job.id,
        sourceId: job.data?.sourceId,
        error: err.message,
      });
    });

    this.processorRegistered = true;
    logger.info(`${TAG} Sync queue processors registered`);
  }

  async enqueueManualSync(sourceId: string): Promise<void> {
    const queue = await this.ensureQueue();
    const jobId = `microsoft-calendar-manual-${sourceId}`;
    await clearDeadJobForReenqueue(queue, jobId);
    await queue.add(
      'manual-sync',
      { sourceId },
      { jobId }
    );
  }

  async enqueueIncrementalSync(sourceId: string): Promise<void> {
    const queue = await this.ensureQueue();
    const jobId = `microsoft-calendar-incremental-${sourceId}`;
    await clearDeadJobForReenqueue(queue, jobId);
    await queue.add(
      'incremental-sync',
      { sourceId },
      { jobId }
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.processorRegistered = false;
    }
  }
}

export const microsoftCalendarSyncQueue = new MicrosoftCalendarSyncQueue();

export async function enqueueMicrosoftCalendarManualSync(sourceId: string): Promise<void> {
  await microsoftCalendarSyncQueue.enqueueManualSync(sourceId);
}
