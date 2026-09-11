/**
 * Google Calendar Sync Queue
 *
 * Two distinct sync modes:
 *  1. FULL SYNC — Fetches next 30 days, compares with DB, upserts all, and cancels ones not
 *                 in the 30-day window. Enqueued by user-triggered sync and by watch setup.
 *  2. INCREMENTAL SYNC — Triggered by webhook push. Uses syncToken to fetch only changes
 *                        from Google, upserts ONLY changed events, never touches other calls.
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
  fetchGoogleEventsInRange,
  fetchGoogleIncrementalChanges,
  fetchAllGoogleEventsForBaseline,
} from '@/services/googleCalendarApi';
import { storeGCalEventsAsCallsForUser } from '@/services/googleCalendarCallStore';
import { reconcileXyneCallLinks } from '@/services/xyneCallLinkInjector';
import { GoogleCalendarWatchService } from '@/services/googleCalendarWatchService';
import {
  CALENDAR_INCREMENTAL_CONTINUATION_DELAY_MS,
  CALENDAR_SYNC_LOOKAHEAD_DAYS,
  MAX_CALENDAR_EVENTS_PER_SYNC,
} from '@/services/calendarSyncConfig';
import { calendarSyncErrorMessage, isPermanentCalendarAuthError } from './calendarSyncErrorUtils';

const TAG = '[CALENDAR_SYNC][GOOGLE][QUEUE]';

type CalendarSyncJobData = {
  sourceId?: string;
  syncToken?: string;
  pageToken?: string;
};

type GoogleIncrementalContinuation = {
  sourceId: string;
  syncToken: string;
  pageToken: string;
};

type EnqueueIncrementalSyncOptions = {
  delayMs?: number;
  jobIdSuffix?: string;
};

function continuationJobId(sourceId: string, pageToken: string): string {
  const tokenHash = createHash('sha1').update(pageToken).digest('hex');
  return `google-calendar-incremental-${sourceId}-${tokenHash}`;
}

/**
 * Bull refuses to create a new job when a job with the same jobId already
 * exists in a terminal state (failed/completed) that hasn't been removed.
 * Since our jobIds are deterministic per sourceId (by design, to serialize
 * access to the Google syncToken cursor), a single exhausted-retries failure
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
    'Google calendar sync job missing sourceId; email-based calendar jobs are not supported'
  );
}

async function performManualSync(sourceId: string): Promise<void> {
  const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.GOOGLE);
  if (!credentials) {
    throw new Error(`No active Google calendar credentials found for source ${sourceId}`);
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
    const { events, truncated } = await fetchGoogleEventsInRange(
      credentials.accessToken,
      now,
      future,
      MAX_CALENDAR_EVENTS_PER_SYNC
    );

    const reconciledEvents = await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      reconcileXyneCallLinks(events, credentials, user.email, user.workspaceId),
    );

    await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      storeGCalEventsAsCallsForUser(reconciledEvents, userId, user.email, {
        isFullSync: true,
        timeRange: { startsAfter: now, startsBefore: future },
        skipCancelRemoved: truncated,
      }),
    );

    await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, true);

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
      await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, false);
    } else {
      logger.warn(`${TAG} Transient sync failure, keeping source active ${sourceId}`);
    }
    throw err;
  }
}

async function performIncrementalSync(
  sourceId: string,
  jobData: CalendarSyncJobData
): Promise<GoogleIncrementalContinuation | null> {
  const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.GOOGLE);
  if (!credentials) {
    throw new Error(`No active Google calendar credentials found for source ${sourceId}`);
  }

  const userId = credentials.userId;
  const user = await repositories.users.findById(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const subscription = await repositories.externalSources.findById(sourceId);

  if (!subscription?.lastSyncCursor) {
    logger.info(`${TAG} No syncToken, establishing baseline for user ${user.email}`, {
      sourceId,
      userId,
    });

    const { events, nextSyncToken, truncated } = await fetchAllGoogleEventsForBaseline(
      credentials.accessToken,
      MAX_CALENDAR_EVENTS_PER_SYNC
    );

    const reconciledEvents = await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      reconcileXyneCallLinks(events, credentials, user.email, user.workspaceId),
    );

    await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
      storeGCalEventsAsCallsForUser(reconciledEvents, userId, user.email, {
        isFullSync: true,
        skipCancelRemoved: truncated,
      }),
    );
    await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, nextSyncToken, true);

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
    const syncToken = jobData.syncToken ?? subscription.lastSyncCursor;
    const result = await fetchGoogleIncrementalChanges(credentials.accessToken, syncToken, {
      maxEvents: MAX_CALENDAR_EVENTS_PER_SYNC,
      pageToken: jobData.pageToken,
    });

    if (result.needsFullSync) {
      logger.warn(`${TAG} syncToken expired, re-establishing baseline for user ${user.email}`, {
        sourceId,
        userId,
      });

      const { events, nextSyncToken, truncated } = await fetchAllGoogleEventsForBaseline(
        credentials.accessToken,
        MAX_CALENDAR_EVENTS_PER_SYNC
      );

      const reconciledEvents = await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
        reconcileXyneCallLinks(events, credentials, user.email, user.workspaceId),
      );

      await runWithContext({ userId, workspaceId: user.workspaceId }, () =>
        storeGCalEventsAsCallsForUser(reconciledEvents, userId, user.email, {
          isFullSync: true,
          skipCancelRemoved: truncated,
        }),
      );
      await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, nextSyncToken, true);

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

    await runWithContext({ userId, workspaceId: user.workspaceId }, async () => {
      const reconciledEvents = await reconcileXyneCallLinks(result.events, credentials, user.email, user.workspaceId);
      await storeGCalEventsAsCallsForUser(reconciledEvents, userId, user.email, { isFullSync: false });
    });

    if (result.nextPageToken) {
      logger.warn(`${TAG} Incremental sync hit event cap, scheduling continuation`, {
        sourceId,
      });
      return { sourceId, syncToken, pageToken: result.nextPageToken };
    }

    if (result.nextSyncToken) {
      await GoogleCalendarWatchService.updateSyncStateBySourceId(
        sourceId,
        result.nextSyncToken,
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
      await GoogleCalendarWatchService.updateSyncStateBySourceId(
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
  await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════════════════════

class GoogleCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private processorRegistered = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('google-calendar-sync', {
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
   * The webhook route (API) enqueues; the work itself — Google API paging,
   * event upserts, syncToken bookkeeping — runs here, off the request path.
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
      let continuation: GoogleIncrementalContinuation | null;
      try {
        continuation = await performIncrementalSync(sourceId, jobData);
      } catch (err) {
        await deactivateSourceOnPermanentAuthError(sourceId, err);
        throw err;
      }
      if (continuation) {
        const continuationId = continuationJobId(continuation.sourceId, continuation.pageToken);
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
    const jobId = `google-calendar-manual-${sourceId}`;
    await clearDeadJobForReenqueue(queue, jobId);
    await queue.add(
      'manual-sync',
      { sourceId },
      { jobId }
    );
  }

  async enqueueIncrementalSync(
    sourceId: string,
    options?: EnqueueIncrementalSyncOptions
  ): Promise<void> {
    const queue = await this.ensureQueue();
    const jobIdSuffix = options?.jobIdSuffix ? `-${options.jobIdSuffix}` : '';
    const jobId = `google-calendar-incremental-${sourceId}${jobIdSuffix}`;
    await clearDeadJobForReenqueue(queue, jobId);
    await queue.add(
      'incremental-sync',
      { sourceId },
      {
        jobId,
        delay: options?.delayMs ?? 0,
      }
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

export const googleCalendarSyncQueue = new GoogleCalendarSyncQueue();

export async function enqueueGoogleCalendarManualSync(sourceId: string): Promise<void> {
  await googleCalendarSyncQueue.enqueueManualSync(sourceId);
}
