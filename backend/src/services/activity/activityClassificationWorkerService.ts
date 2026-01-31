import { Activity, ActivityClassification, ActivityClassificationJobType } from '@prisma/client';
import { db } from '@/database/client';
import { activityClassificationService } from '@/services/activity/activityClassificationService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 15000;
const BATCH_SIZE = 25;
const MAX_RETRIES = config.activityClassification?.maxRetries ?? 2;

class ActivityClassificationWorkerService {
  private isRunning = false;
  private currentInterval = MIN_INTERVAL_MS;
  private timeoutId?: NodeJS.Timeout;
  private retryCounts = new Map<string, number>();

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[ActivityClassificationWorker] Already started');
      return;
    }

    this.isRunning = true;
    logger.info('[ActivityClassificationWorker] Started');
    await this.resetProcessingOnStart();
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    logger.info('[ActivityClassificationWorker] Stopped');
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.timeoutId = setTimeout(async () => {
      try {
        await this.pollAndProcess();
      } catch (error) {
        logger.error('[ActivityClassificationWorker] Polling error', error as Error);
      } finally {
        this.scheduleNextPoll();
      }
    }, this.currentInterval);
  }

  private async pollAndProcess(): Promise<void> {
    const audienceActivities = await this.claimSpecialMentionAudienceActivities();
    if (audienceActivities.length > 0) {
      await this.processSpecialMentionAudienceActivities(audienceActivities);
      this.currentInterval = MIN_INTERVAL_MS;
      return;
    }

    const activities = await this.claimSingleActivities();
    if (activities.length === 0) {
      this.currentInterval = MAX_INTERVAL_MS;
      return;
    }

    this.currentInterval = MIN_INTERVAL_MS;
    const results = await Promise.allSettled(
      activities.map(activity => this.processSingleActivity(activity))
    );
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('[ActivityClassificationWorker] Batch processing completed with failures', {
        total: activities.length,
        failures: failures.length,
        successRate: `${(((activities.length - failures.length) / activities.length) * 100).toFixed(2)}%`,
      });
    }
  }

  private async resetProcessingOnStart(): Promise<void> {
    const result = await db.activity.updateMany({
      where: {
        classification: ActivityClassification.PROCESSING,
      },
      data: {
        classification: ActivityClassification.PENDING,
      },
    });

    if (result.count > 0) {
      logger.warn('[ActivityClassificationWorker] Reset PROCESSING activities on startup', {
        count: result.count,
      });
    }
  }

  private async claimSingleActivities(): Promise<Activity[]> {
    return db.$queryRaw<Activity[]>`
      WITH cte AS (
        SELECT "id"
        FROM "activities"
        WHERE "classification" = ${ActivityClassification.PENDING}::"ActivityClassification"
          AND ("classificationJobType" IS NULL OR "classificationJobType" = ${ActivityClassificationJobType.SINGLE}::"ActivityClassificationJobType")
        ORDER BY "createdAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "activities" a
      SET "classification" = ${ActivityClassification.PROCESSING}::"ActivityClassification"
      FROM cte
      WHERE a."id" = cte."id"
      RETURNING a.*;
    `;
  }

  private async claimSpecialMentionAudienceActivities(): Promise<Activity[]> {
    return db.$queryRaw<Activity[]>`
      WITH batch AS (
        SELECT "actionSourceId", "channelId"
        FROM "activities"
        WHERE "classification" = ${ActivityClassification.PENDING}::"ActivityClassification"
          AND "classificationJobType" = ${ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE}::"ActivityClassificationJobType"
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        SELECT "id"
        FROM "activities" a
        JOIN batch b
          ON a."actionSourceId" = b."actionSourceId"
         AND a."channelId" = b."channelId"
        WHERE a."classification" = ${ActivityClassification.PENDING}::"ActivityClassification"
          AND a."classificationJobType" = ${ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE}::"ActivityClassificationJobType"
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "activities" a
      SET "classification" = ${ActivityClassification.PROCESSING}::"ActivityClassification"
      FROM claimed
      WHERE a."id" = claimed."id"
      RETURNING a.*;
    `;
  }

  private async processSingleActivity(activity: Activity): Promise<void> {
    try {
      const result = await activityClassificationService.classifyActivity(activity.id);

      if (result.status === 'classified' || result.status === 'skipped') {
        await this.finalizeActivities([activity.id]);
        return;
      }

      if (result.status === 'pending') {
        await this.scheduleRetry([activity], result.reason ?? 'pending');
        return;
      }

      if (result.status === 'error') {
        await this.markPermanentFailure([activity], result.reason ?? 'error');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      logger.error('[ActivityClassificationWorker] Single activity failed', {
        activityId: activity.id,
        errorMessage: err.message,
        errorStack: err.stack,
      });
      await this.scheduleRetry([activity], err.message);
    }
  }

  private async processSpecialMentionAudienceActivities(activities: Activity[]): Promise<void> {
    if (activities.length === 0) return;
    const [first] = activities;
    if (!first.actionSourceId || !first.channelId) {
      await this.markPermanentFailure(activities, 'missing_audience_metadata');
      return;
    }

    const activityIds = activities.map(activity => activity.id);
    const recipientUserIds = activities.map(activity => activity.userId);

    try {
      const result = await activityClassificationService.classifySpecialMentionAudience({
        activityIds,
        messageId: first.actionSourceId,
        channelId: first.channelId,
        recipientUserIds,
      });

      if (result.status === 'classified' || result.status === 'skipped') {
        const retryKey = this.getAudienceRetryKey(activities);
        await this.finalizeActivities(activityIds, retryKey ?? undefined);
        return;
      }

      if (result.status === 'pending') {
        await this.scheduleRetry(activities, result.reason ?? 'pending');
        return;
      }

      if (result.status === 'error') {
        await this.markPermanentFailure(activities, result.reason ?? 'error');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      logger.error('[ActivityClassificationWorker] Audience classification failed', {
        messageId: first.actionSourceId,
        channelId: first.channelId,
        errorMessage: err.message,
        errorStack: err.stack,
      });
      await this.scheduleRetry(activities, err.message);
    }
  }

  private async finalizeActivities(activityIds: string[], retryKey?: string): Promise<void> {
    if (activityIds.length === 0) return;
    await db.activity.updateMany({
      where: { id: { in: activityIds } },
      data: {
        classificationJobType: null,
      },
    });
    if (retryKey) {
      this.retryCounts.delete(retryKey);
      return;
    }
    activityIds.forEach(id => this.retryCounts.delete(id));
  }

  private async scheduleRetry(activities: Activity[], reason: string): Promise<void> {
    if (activities.length === 0) return;

    const retryKey = this.getRetryKey(activities);
    if (!retryKey) {
      await this.markPermanentFailure(activities, 'missing_retry_key');
      return;
    }

    const attempts = (this.retryCounts.get(retryKey) ?? 0) + 1;
    this.retryCounts.set(retryKey, attempts);

    if (attempts > MAX_RETRIES) {
      this.retryCounts.delete(retryKey);
      await this.markPermanentFailure(activities, reason);
      return;
    }

    await db.activity.updateMany({
      where: { id: { in: activities.map(a => a.id) } },
      data: {
        classification: ActivityClassification.PENDING,
      },
    });
  }

  private async markPermanentFailure(activities: Activity[], reason: string): Promise<void> {
    if (activities.length === 0) return;
    const retryKey = this.getRetryKey(activities);
    if (retryKey) {
      this.retryCounts.delete(retryKey);
    }
    logger.warn('[ActivityClassificationWorker] Marking activities as ERROR', {
      count: activities.length,
      reason,
    });
    await db.activity.updateMany({
      where: { id: { in: activities.map(a => a.id) } },
      data: {
        classification: ActivityClassification.ERROR,
        classificationJobType: null,
      },
    });
  }

  private getRetryKey(activities: Activity[]): string | null {
    if (activities.length === 0) return null;
    if (activities.length === 1) return activities[0].id;
    return this.getAudienceRetryKey(activities);
  }

  private getAudienceRetryKey(activities: Activity[]): string | null {
    if (activities.length === 0) return null;
    const first = activities[0];
    if (!first.actionSourceId || !first.channelId) return null;
    return `audience:${first.actionSourceId}:${first.channelId}`;
  }
}

export const activityClassificationWorkerService = new ActivityClassificationWorkerService();
