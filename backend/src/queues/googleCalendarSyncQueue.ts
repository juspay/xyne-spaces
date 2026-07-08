/**
 * Google Calendar Sync Queue
 *
 * Two distinct sync modes:
 *  1. MANUAL SYNC — Triggered by user button press. Fetches next 30 days, compares with DB,
 *                   upserts all, cancels ones not in the 30-day window.
 *  2. INCREMENTAL SYNC — Triggered by webhook push. Uses syncToken to fetch only changes
 *                        from Google, upserts ONLY changed events, never touches other calls.
 */

import Bull from 'bull';
import { createHash } from 'crypto';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { AuthProvider } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  fetchGoogleEventsInRange,
  fetchGoogleIncrementalChanges,
  fetchAllGoogleEventsForBaseline,
} from '@/services/googleCalendarApi';
import { storeGCalEventsAsCallsForUser } from '@/services/googleCalendarCallStore';
import { GoogleCalendarWatchService } from '@/services/googleCalendarWatchService';
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

async function resolveSourceId(jobData: CalendarSyncJobData): Promise<string> {
  if (jobData.sourceId) return jobData.sourceId;
  throw new Error('Google calendar sync job missing sourceId; email-based calendar jobs are not supported');
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

  logger.info(`[GOOGLE_CALENDAR] Manual sync for user ${user.email}`);

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + CALENDAR_SYNC_LOOKAHEAD_DAYS);

  try {
    const { events, truncated } = await fetchGoogleEventsInRange(
      credentials.accessToken,
      now,
      future,
      MAX_CALENDAR_EVENTS_PER_SYNC,
    );

    await storeGCalEventsAsCallsForUser(events, userId, user.email, {
      isFullSync: true,
      timeRange: { startsAfter: now, startsBefore: future },
      skipCancelRemoved: truncated,
    });

    await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, true);

    logger.info(`[GOOGLE_CALENDAR] Manual sync complete for user ${user.email}: ${events.length} event(s)`);
    if (truncated) {
      logger.warn(`[GOOGLE_CALENDAR] Manual sync hit event cap for user ${user.email}`);
    }
  } catch (err) {
    const errorMessage = calendarSyncErrorMessage(err);
    logger.error(`[GOOGLE_CALENDAR] Sync failed for source ${sourceId}: ${errorMessage}`);
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`[GOOGLE_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`);
      await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, false);
    } else {
      logger.warn(`[GOOGLE_CALENDAR] Transient sync failure, keeping source active ${sourceId}`);
    }
    throw err;
  }
}

async function performIncrementalSync(
  sourceId: string,
  jobData: CalendarSyncJobData,
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
    logger.info(`[GOOGLE_CALENDAR] No syncToken, establishing baseline for user ${user.email}`);

    const { events, nextSyncToken, truncated } = await fetchAllGoogleEventsForBaseline(
      credentials.accessToken,
      MAX_CALENDAR_EVENTS_PER_SYNC,
    );

    await storeGCalEventsAsCallsForUser(events, userId, user.email, {
      isFullSync: true,
      skipCancelRemoved: truncated,
    });
    await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, nextSyncToken, true);

    logger.info(`[GOOGLE_CALENDAR] Baseline established for user ${user.email}: ${events.length} event(s)`);
    if (truncated) {
      logger.warn(`[GOOGLE_CALENDAR] Baseline sync hit event cap for user ${user.email}`);
    }
    return null;
  }

  logger.info(`[GOOGLE_CALENDAR] Incremental sync for user ${user.email}`);

  try {
    const syncToken = jobData.syncToken ?? subscription.lastSyncCursor;
    const result = await fetchGoogleIncrementalChanges(credentials.accessToken, syncToken, {
      maxEvents: MAX_CALENDAR_EVENTS_PER_SYNC,
      pageToken: jobData.pageToken,
    });

    if (result.needsFullSync) {
      logger.warn(`[GOOGLE_CALENDAR] syncToken expired, re-establishing baseline for user ${user.email}`);

      const { events, nextSyncToken, truncated } = await fetchAllGoogleEventsForBaseline(
        credentials.accessToken,
        MAX_CALENDAR_EVENTS_PER_SYNC,
      );

      await storeGCalEventsAsCallsForUser(events, userId, user.email, {
        isFullSync: true,
        skipCancelRemoved: truncated,
      });
      await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, nextSyncToken, true);

      logger.info(`[GOOGLE_CALENDAR] Baseline re-established for user ${user.email}: ${events.length} event(s)`);
      if (truncated) {
        logger.warn(`[GOOGLE_CALENDAR] Baseline re-sync hit event cap for user ${user.email}`);
      }
      return null;
    }

    await storeGCalEventsAsCallsForUser(result.events, userId, user.email, { isFullSync: false });

    if (result.nextPageToken) {
      logger.warn(`[GOOGLE_CALENDAR] Incremental sync hit event cap, scheduling continuation`, {
        sourceId,
      });
      return { sourceId, syncToken, pageToken: result.nextPageToken };
    }

    if (result.nextSyncToken) {
      await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, result.nextSyncToken, true);
    }

    logger.info(`[GOOGLE_CALENDAR] Incremental sync complete for user ${user.email}: ${result.events.length} changed event(s)`);
    return null;
  } catch (err) {
    if (isPermanentCalendarAuthError(err)) {
      logger.error(`[GOOGLE_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
      await GoogleCalendarWatchService.updateSyncStateBySourceId(
        sourceId,
        subscription?.lastSyncCursor,
        false,
      );
    } else {
      logger.warn(`[GOOGLE_CALENDAR] Transient sync failure, keeping source active ${sourceId}`, {
        error: calendarSyncErrorMessage(err),
      });
    }
    throw err;
  }
}

async function deactivateSourceOnPermanentAuthError(sourceId: string, err: unknown): Promise<void> {
  if (!isPermanentCalendarAuthError(err)) return;

  logger.error(`[GOOGLE_CALENDAR] Permanent auth failure, deactivating source ${sourceId}`, {
    error: calendarSyncErrorMessage(err),
  });
  await GoogleCalendarWatchService.updateSyncStateBySourceId(sourceId, undefined, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════════════════════

class GoogleCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

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
      let continuation: GoogleIncrementalContinuation | null;
      try {
        continuation = await performIncrementalSync(sourceId, jobData);
      } catch (err) {
        await deactivateSourceOnPermanentAuthError(sourceId, err);
        throw err;
      }
      if (continuation) {
        await queue.add('incremental-sync', continuation, {
          jobId: continuationJobId(continuation.sourceId, continuation.pageToken),
          delay: 0,
        });
      }
    });

    queue.on('failed', (job, err) => {
      logger.error('[GOOGLE_CALENDAR] Sync job failed', {
        jobName: job.name,
        jobId: job.id,
        sourceId: job.data?.sourceId,
        error: err.message,
      });
    });

    this.workerInitialized = true;
    logger.info('[GOOGLE_CALENDAR] Google Calendar sync queue initialized');
  }

  async enqueueManualSync(sourceId: string): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add('manual-sync', { sourceId }, {
      jobId: `google-calendar-manual-${sourceId}`,
    });
  }

  async enqueueIncrementalSync(
    sourceId: string,
    options?: EnqueueIncrementalSyncOptions,
  ): Promise<void> {
    const queue = await this.ensureQueue();
    const jobIdSuffix = options?.jobIdSuffix ? `-${options.jobIdSuffix}` : '';
    await queue.add('incremental-sync', { sourceId }, {
      jobId: `google-calendar-incremental-${sourceId}${jobIdSuffix}`,
      delay: options?.delayMs ?? 0,
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const googleCalendarSyncQueue = new GoogleCalendarSyncQueue();

export async function syncGoogleCalendarManually(sourceId: string): Promise<void> {
  await googleCalendarSyncQueue.enqueueManualSync(sourceId);
}
