import Bull from 'bull';
import { ActivityClassification, NotificationType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import '@/integrations';
import { notificationService } from '@/notification-service';
import { activityService } from '@/services/activity/activityService';
import {
  emailFetchQueue,
  type EmailFetchJobData,
  type SocialMediaFetchJobData,
  type EmailFetchQueueJobData,
  type CursorCatchupJobData,
} from '@/queues/emailFetchQueue';
import { runAsServiceActor } from '@/database/tenant/context';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { getHttpStatus } from '@/services/googleService';
import { catchUpFromCursor } from '@/integrations/adapters/google/refetch';
import { seedSyncCursor } from '@/services/syncCursorRecovery';

const externalSourceRepo = new ExternalSourceRepository();

class EmailFetchWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await emailFetchQueue.initialize();

    const queue = emailFetchQueue.getQueue();

    queue.process('refetch', 1, async (job) => {
      return this.processJob(job as Bull.Job<EmailFetchJobData>);
    });
    queue.process('social-media-refetch', 1, async (job) => {
      return this.processSocialMediaJob(job as Bull.Job<SocialMediaFetchJobData>);
    });

    queue.process('cursor-catchup', 1, async (job: Bull.Job<EmailFetchQueueJobData>) => {
      return this.processCursorCatchup(job as Bull.Job<CursorCatchupJobData>);
    });

    queue.on('failed', (job, err) => {
      const source = 'sourceId' in job.data ? job.data.sourceId : job.data.sourceIds.join(',');
      logger.error(
        `[EMAIL-FETCH-WORKER] Job ${job.id} (${job.name}) failed — source ${source}:`,
        err,
      );

      if ('sourceIds' in job.data) {
        void this.notifySocialMediaFailure(job.data, err);
      } else if (job.name === 'refetch') {
        void this.notifyFailure(job.data as EmailFetchJobData, err);
      }
    });

    this.isInitialized = true;
    logger.info('[EMAIL-FETCH-WORKER] Started, ready to process jobs');
  }

  private async processCursorCatchup(
    job: Bull.Job<CursorCatchupJobData>,
  ): Promise<void> {
    const { sourceId, watchHistoryId, requesterUserId } = job.data;
    const source = await externalSourceRepo.findById(sourceId);
    if (!source || !source.isActive) {
      logger.warn(`[EMAIL-FETCH-WORKER] Catchup: source ${sourceId} missing or inactive — skipping`);
      return;
    }

    const { workspaceId, channelId } = source;
    if (!workspaceId) {
      logger.error(`[EMAIL-FETCH-WORKER] Catchup: source has no workspace — skipping`, {
        sourceId,
        sourceName: source.name,
      });
      return;
    }

    const cursor = source.lastSyncCursor;
    if (!cursor) {
      await seedSyncCursor({
        source,
        seedHistoryId: watchHistoryId,
        reason: 'no-cursor',
        requesterUserId,
      });
      return;
    }

    const adapter = adapterRegistry.getAdapter(source.name);
    try {
      const result = await runAsServiceActor('email-fetch-worker', workspaceId, () =>
        catchUpFromCursor(source, adapter, cursor),
      );

      logger.info(
        `[EMAIL-FETCH-WORKER] Catchup done — source ${source.name}: processed=${result.processed} new=${result.newTickets} skipped=${result.skipped} errors=${result.errors?.length ?? 0}`,
      );

      if (result.newTickets > 0 && requesterUserId && channelId) {
        await this.notifySuccess(
          { sourceId, workspaceId, channelId, requesterUserId },
          result,
        );
      }
    } catch (error) {
      if (getHttpStatus(error) !== 404) {
        logger.warn(`[EMAIL-FETCH-WORKER] Catchup failed transiently — retrying`, {
          sourceId,
          sourceName: source.name,
          status: getHttpStatus(error),
        });
        throw error;
      }
      await seedSyncCursor({
        source,
        seedHistoryId: watchHistoryId,
        reason: 'cursor-expired',
        requesterUserId,
      });
    }
  }

  private async processJob(job: Bull.Job<EmailFetchJobData>): Promise<void> {
    const { sourceId, channelId, startDate, endDate, targetChannelId, dlEmail } = job.data;
    logger.info(
      `[EMAIL-FETCH-WORKER] Processing job ${job.id} — source ${sourceId} (channel ${channelId})`,
    );

    const sourceRepo = new ExternalSourceRepository();
    const source = await sourceRepo.findById(sourceId);
    if (!source || !source.isActive) {
      logger.warn(
        `[EMAIL-FETCH-WORKER] Source ${sourceId} missing or inactive — skipping`,
      );
      return;
    }

    const adapter = adapterRegistry.getAdapter(source.name);
    if (!adapter.refetch) {
      logger.warn(
        `[EMAIL-FETCH-WORKER] Adapter ${source.name} does not support fetch — skipping`,
      );
      return;
    }

    const options =
      startDate && endDate
        ? {
            startDate,
            endDate,
            ...(targetChannelId && { targetChannelId }),
            ...(dlEmail && { dlEmail }),
          }
        : undefined;
    let result: Awaited<ReturnType<NonNullable<typeof adapter.refetch>>>;
    try {
      // Background job → open a tenant scope from the job's workspaceId so ingested
      // emails/drafts/assignments get workspaceId stamped instead of leaking NULL.
      result = await runAsServiceActor('email-fetch-worker', job.data.workspaceId,
        () => adapter.refetch!(source, options),
      );
    } catch (error) {
      if (job.data.isDlMemberSync && this.isFinalAttempt(job)) {
        await this.cleanupDlMemberSyncSource(sourceRepo, sourceId);
      }
      throw error;
    }

    logger.info(
      `[EMAIL-FETCH-WORKER] Job ${job.id} done — processed=${result.processed} new=${result.newTickets} skipped=${result.skipped} errors=${result.errors?.length ?? 0}`,
    );

    await this.notifySuccess(job.data, result);

    if (job.data.isDlMemberSync) {
      await this.cleanupDlMemberSyncSource(sourceRepo, sourceId);
    }
  }

  private async processSocialMediaJob(
    job: Bull.Job<SocialMediaFetchJobData>,
  ): Promise<void> {
    const { sourceIds, channelId, workspaceId } = job.data;
    logger.info(
      `[EMAIL-FETCH-WORKER] Processing Google Play job ${job.id} — channel ${channelId}`,
    );

    const synced = await runAsServiceActor(
      'social-media-fetch-worker',
      workspaceId,
      async () => {
        let newInteractionCount = 0;
        for (const sourceId of sourceIds) {
          const result = await socialMediaService.syncSource(sourceId, {
            ignoreSyncCursor: true,
          });
          newInteractionCount += result.synced;
        }
        return newInteractionCount;
      },
    );

    logger.info(
      `[EMAIL-FETCH-WORKER] Google Play job ${job.id} done — new=${synced}`,
    );
    await this.notifySocialMediaSuccess(job.data, synced);
  }

  private isFinalAttempt(job: Bull.Job<EmailFetchJobData>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= maxAttempts;
  }

  private async cleanupDlMemberSyncSource(
    sourceRepo: ExternalSourceRepository,
    sourceId: string,
  ): Promise<void> {
    try {
      await sourceRepo.update(sourceId, { isActive: false, credentials: '' });
      logger.info('[EMAIL-FETCH-WORKER] Deactivated temporary DL member sync source', { sourceId });
    } catch (cleanupErr) {
      logger.warn('[EMAIL-FETCH-WORKER] Failed to deactivate DL sync source', {
        sourceId,
        error: cleanupErr,
      });
    }
  }

  private async notifySuccess(
    data: EmailFetchJobData,
    result: { processed: number; newTickets: number; skipped: number; errors?: string[] },
  ): Promise<void> {
    try {
      const newCount = result.newTickets;
      const skipped = result.skipped;
      const isMemberSync = data.isDlMemberSync;
      const title = isMemberSync
        ? (newCount > 0
          ? `Synced ${newCount} older ${newCount === 1 ? 'email' : 'emails'} from DL member`
          : 'No older emails found to sync')
        : (newCount > 0
          ? `Fetched ${newCount} new ${newCount === 1 ? 'email' : 'emails'}`
          : 'Inbox is up to date');
      const message = isMemberSync
        ? (newCount > 0
          ? `${newCount} new, ${skipped} already existed.`
          : `All ${skipped} emails were already in the desk.`)
        : (newCount > 0
          ? `${newCount} new, ${skipped} already imported.`
          : `${skipped} emails were already imported.`);

      await notificationService.sendNotification(
        data.requesterUserId,
        NotificationType.EMAIL_FETCH_COMPLETED,
        title,
        message,
        {
          channelId: data.channelId,
          sourceId: data.sourceId,
          processed: result.processed,
          newTickets: newCount,
          skipped,
          errorCount: result.errors?.length ?? 0,
        },
        `/${data.workspaceId}/support/${data.channelId}`,
      );
    } catch (err) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to publish completion notification:', err);
    }

    try {
      await activityService.createActivity({
        userId: data.requesterUserId,
        actorAction: 'email_fetch_completed',
        actionSource: 'channel',
        actionSourceId: data.channelId,
        channelId: data.channelId,
        actorId: data.requesterUserId,
        classification: ActivityClassification.FYI,
      });
    } catch (err) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to write completion activity:', err);
    }
  }

  private async notifyFailure(data: EmailFetchJobData, err: Error): Promise<void> {
    try {
      const raw = err?.message ?? String(err);
      const needsReauth = /invalid_grant|unauthorized_client|invalid_token/i.test(raw);
      await notificationService.sendNotification(
        data.requesterUserId,
        NotificationType.EMAIL_FETCH_FAILED,
        'Email fetch failed',
        needsReauth
          ? 'The connected account requires re-authorization. Please reconnect.'
          : raw.substring(0, 200),
        {
          channelId: data.channelId,
          sourceId: data.sourceId,
          needsReauth,
        },
        `/${data.workspaceId}/support/${data.channelId}`,
      );
    } catch (notifyErr) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to publish failure notification:', notifyErr);
    }

    try {
      await activityService.createActivity({
        userId: data.requesterUserId,
        actorAction: 'email_fetch_failed',
        actionSource: 'channel',
        actionSourceId: data.channelId,
        channelId: data.channelId,
        actorId: data.requesterUserId,
        classification: ActivityClassification.ACTIONABLE,
      });
    } catch (activityErr) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to write failure activity:', activityErr);
    }
  }

  private async notifySocialMediaSuccess(
    data: SocialMediaFetchJobData,
    synced: number,
  ): Promise<void> {
    try {
      await notificationService.sendNotification(
        data.requesterUserId,
        NotificationType.EMAIL_FETCH_COMPLETED,
        synced > 0
          ? `Fetched ${synced} new Google Play interaction${synced === 1 ? '' : 's'}`
          : 'Google Play reviews are up to date',
        synced > 0
          ? `${synced} new review interaction${synced === 1 ? '' : 's'} added to the desk.`
          : 'No new review interactions were found.',
        {
          channelId: data.channelId,
          sourceCount: data.sourceIds.length,
          synced,
        },
        `/${data.workspaceId}/support/${data.channelId}`,
      );
    } catch (error) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to publish Google Play completion notification', {
        error,
      });
    }
  }

  private async notifySocialMediaFailure(
    data: SocialMediaFetchJobData,
    error: Error,
  ): Promise<void> {
    try {
      await notificationService.sendNotification(
        data.requesterUserId,
        NotificationType.EMAIL_FETCH_FAILED,
        'Google Play review fetch failed',
        error.message.substring(0, 200),
        {
          channelId: data.channelId,
          sourceCount: data.sourceIds.length,
        },
        `/${data.workspaceId}/support/${data.channelId}`,
      );
    } catch (notificationError) {
      logger.error('[EMAIL-FETCH-WORKER] Failed to publish Google Play failure notification', {
        error: notificationError,
      });
    }
  }

  async shutdown(): Promise<void> {
    await emailFetchQueue.close();
    this.isInitialized = false;
    logger.info('[EMAIL-FETCH-WORKER] Shut down');
  }
}

export const emailFetchWorker = new EmailFetchWorker();
