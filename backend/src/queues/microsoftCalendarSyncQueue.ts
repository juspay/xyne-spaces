/**
 * Microsoft Calendar Sync Queue
 *
 * Two distinct sync modes:
 *  1. MANUAL SYNC — Triggered by user button press. Fetches next 30 days of calendarView,
 *                   compares with DB, upserts all, cancels ones not in the window.
 *  2. INCREMENTAL SYNC — Triggered by webhook push. Uses deltaLink to fetch only changes
 *                        from Microsoft Graph, upserts ONLY changed events, never touches other calls.
 */

import Bull from 'bull';
import { createHash } from 'crypto';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { AuthProvider } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  fetchMicrosoftEventsInRange,
  fetchMicrosoftDeltaChanges,
  fetchAllMicrosoftEventsForBaseline,
} from '@/services/microsoftCalendarApi';
import { storeMsCalEventsAsCallsForUser } from '@/services/microsoftCalendarCallStore';
import { MicrosoftCalendarSubscriptionService } from '@/services/microsoftCalendarSubscriptionService';
import {
  CALENDAR_SYNC_LOOKAHEAD_DAYS,
  MAX_CALENDAR_EVENTS_PER_SYNC,
} from '@/services/calendarSyncConfig';
import {
  calendarSyncErrorMessage,
  isPermanentCalendarAuthError,
} from './calendarSyncErrorUtils';

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

async function resolveSourceId(jobData: CalendarSyncJobData): Promise<string> {
  if (jobData.sourceId) return jobData.sourceId;
  throw new Error('Microsoft calendar sync job missing sourceId; email-based calendar jobs are not supported');
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

  logger.info(`[MICROSOFT_CALENDAR] Manual sync for user ${user.email}`);

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + CALENDAR_SYNC_LOOKAHEAD_DAYS);

  try {
    const { events, truncated } = await fetchMicrosoftEventsInRange(
      credentials.accessToken,
      now,
      future,
      MAX_CALENDAR_EVENTS_PER_SYNC,
    );

    await storeMsCalEventsAsCallsForUser(events, userId, user.email, {
      isFullSync: true,
      timeRange: { startsAfter: now, startsBefore: future },
      skipCancelRemoved: truncated,
    });

    await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, undefined, true);

    logger.info(`[MICROSOFT_CALENDAR] Manual sync complete for user ${user.email}: ${events.length} event(s)`);
    if (truncated) {
      logger.warn(`[MICROSOFT_CALENDAR] Manual sync hit event cap for user ${user.email}`);
    }
  } catch (err) {
    const errorMessage = calendarSyncErrorMessage(err);
    logger.error(`[MICROSOFT_CALENDAR] Sync failed for source ${sourceId}: ${errorMessage}`);
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`[MICROSOFT_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`);
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, undefined, false);
    } else {
      logger.warn(`[MICROSOFT_CALENDAR] Transient sync failure, keeping source active ${sourceId}`);
    }
    throw err;
  }
}

async function performIncrementalSync(
  sourceId: string,
  jobData: CalendarSyncJobData,
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
    logger.info(`[MICROSOFT_CALENDAR] No deltaLink, establishing baseline for user ${user.email}`);

    const { events, deltaLink, truncated } = await fetchAllMicrosoftEventsForBaseline(
      credentials.accessToken,
      CALENDAR_SYNC_LOOKAHEAD_DAYS,
      MAX_CALENDAR_EVENTS_PER_SYNC,
    );

    await storeMsCalEventsAsCallsForUser(events, userId, user.email, {
      isFullSync: true,
      skipCancelRemoved: truncated,
    });
    await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, deltaLink, true);

    logger.info(`[MICROSOFT_CALENDAR] Baseline established for user ${user.email}: ${events.length} event(s)`);
    if (truncated) {
      logger.warn(`[MICROSOFT_CALENDAR] Baseline sync hit event cap for user ${user.email}`);
    }
    return null;
  }

  logger.info(`[MICROSOFT_CALENDAR] Incremental sync for user ${user.email}`);

  try {
    const deltaLink = jobData.deltaLink ?? subscription.lastSyncCursor;
    const result = await fetchMicrosoftDeltaChanges(
      credentials.accessToken,
      deltaLink,
      MAX_CALENDAR_EVENTS_PER_SYNC,
    );

    if (result.needsFullSync) {
      logger.warn(`[MICROSOFT_CALENDAR] deltaLink expired, re-establishing baseline for user ${user.email}`);

      const { events, deltaLink: newDeltaLink, truncated } = await fetchAllMicrosoftEventsForBaseline(
        credentials.accessToken,
        CALENDAR_SYNC_LOOKAHEAD_DAYS,
        MAX_CALENDAR_EVENTS_PER_SYNC,
      );

      await storeMsCalEventsAsCallsForUser(events, userId, user.email, {
        isFullSync: true,
        skipCancelRemoved: truncated,
      });
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, newDeltaLink, true);

      logger.info(`[MICROSOFT_CALENDAR] Baseline re-established for user ${user.email}: ${events.length} event(s)`);
      if (truncated) {
        logger.warn(`[MICROSOFT_CALENDAR] Baseline re-sync hit event cap for user ${user.email}`);
      }
      return null;
    }

    await storeMsCalEventsAsCallsForUser(result.events, userId, user.email, { isFullSync: false });

    if (result.nextLink) {
      logger.warn(`[MICROSOFT_CALENDAR] Incremental sync hit event cap, scheduling continuation`, {
        sourceId,
      });
      return { sourceId, deltaLink: result.nextLink };
    }

    if (result.newDeltaLink) {
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, result.newDeltaLink, true);
    }

    logger.info(`[MICROSOFT_CALENDAR] Incremental sync complete for user ${user.email}: ${result.events.length} changed event(s)`);
    return null;
  } catch (err) {
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`[MICROSOFT_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
      await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(
        sourceId,
        subscription?.lastSyncCursor,
        false,
      );
    } else {
      logger.warn(`[MICROSOFT_CALENDAR] Transient sync failure, keeping source active ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
    }
    throw err;
  }
}

async function deactivateSourceOnPermanentAuthError(sourceId: string, err: unknown): Promise<void> {
  if (!isPermanentCalendarAuthError(err)) return;

  logger.error(`[MICROSOFT_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`, {
    error: calendarSyncErrorMessage(err),
  });
  await MicrosoftCalendarSubscriptionService.updateSyncStateBySourceId(sourceId, undefined, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════════════════════

class MicrosoftCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

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

  async initialize(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) return;

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
        await queue.add('incremental-sync', continuation, {
          jobId: continuationJobId(continuation.sourceId, continuation.deltaLink),
          delay: 0,
        });
      }
    });

    queue.on('failed', (job, err) => {
      logger.error('[MICROSOFT_CALENDAR] Sync job failed', {
        jobName: job.name,
        jobId: job.id,
        sourceId: job.data?.sourceId,
        error: err.message,
      });
    });

    this.workerInitialized = true;
    logger.info('[MICROSOFT_CALENDAR] Microsoft Calendar sync queue initialized');
  }

  async enqueueManualSync(sourceId: string): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add('manual-sync', { sourceId }, {
      jobId: `microsoft-calendar-manual-${sourceId}`,
    });
  }

  async enqueueIncrementalSync(sourceId: string): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add('incremental-sync', { sourceId }, {
      jobId: `microsoft-calendar-incremental-${sourceId}`,
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const microsoftCalendarSyncQueue = new MicrosoftCalendarSyncQueue();

export async function syncMicrosoftCalendarManually(sourceId: string): Promise<void> {
  await microsoftCalendarSyncQueue.enqueueManualSync(sourceId);
}
