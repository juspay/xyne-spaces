import { Activity } from '@prisma/client';
import { ActivityClassification } from '@xyne/shared';
import { db } from '@/database/client';
import { activityClassificationService } from '@/services/activity/activityClassificationService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { claimSingleActivitiesQuery, claimSpecialMentionAudienceActivitiesQuery } from '@/bypassAcl/activityServices';
import { AgentsConfig } from '@/agents/config';
import { isJevConfigured } from '@/services/queryIntent/jevClient';
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 15000;
const BATCH_SIZE = 25;
const MAX_RETRIES = config.activityClassification?.maxRetries ?? 2;
const STALE_SWEEP_INTERVAL_MS = 60_000;

class ActivityClassificationWorkerService {
  private isRunning = false;
  private currentInterval = MIN_INTERVAL_MS;
  private timeoutId?: NodeJS.Timeout;
  private retryCounts = new Map<string, number>();
  private lastStaleSweepAt = 0;

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[ActivityClassificationWorker] Already started');
      return;
    }

    this.isRunning = true;
    logger.info('[ActivityClassificationWorker] Started');
    if (!isJevConfigured()) {
      // XOR can't answer without it, so every activity goes to the LLM, then its fallback.
      logger.warn('[ActivityClassificationWorker] JEV_API_KEY is not set: XOR is skipped, the LLM classifies');
    }
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
    // The age window lives in CAC (activity_classification_max_age_days), read every poll.
    // The XOR and LLM switches are read per activity, so they too change without a restart.
    const cac = await AgentsConfig.fetch();
    // Only activities newer than this are classified; older ones get their fallback label.
    const since = new Date(Date.now() - cac.activityClassificationMaxAgeDays * 24 * 60 * 60 * 1000);
    await this.fileStaleActivities(since);
    const audienceActivities = await this.claimSpecialMentionAudienceActivities(since);
    if (audienceActivities.length > 0) {
      await this.processSpecialMentionAudienceActivities(audienceActivities);
      this.currentInterval = MIN_INTERVAL_MS;
      return;
    }

    const activities = await this.claimSingleActivities(since);
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
        // Back in the queue — PENDING_CLASSIFY, not legacy PENDING, which is never claimed.
        classification: ActivityClassification.PENDING_CLASSIFY,
      },
    });

    if (result.count > 0) {
      logger.warn('[ActivityClassificationWorker] Reset PROCESSING activities on startup', {
        count: result.count,
      });
    }
  }

  /**
   * Activities still PENDING_CLASSIFY past the age window (the worker was down or behind) get
   * their fallback label at once instead of waiting forever, so Actionable + FYI stays = All.
   * Runs at most once a minute.
   */
  private async fileStaleActivities(since: Date): Promise<void> {
    if (Date.now() - this.lastStaleSweepAt < STALE_SWEEP_INTERVAL_MS) return;
    this.lastStaleSweepAt = Date.now();
    const stale = { classification: ActivityClassification.PENDING_CLASSIFY, createdAt: { lte: since } };
    const [actionable, fyi] = await Promise.all([
      db.activity.updateMany({
        where: { ...stale, fallbackClassification: ActivityClassification.ACTIONABLE },
        data: { classification: ActivityClassification.ACTIONABLE, classificationJobType: null },
      }),
      db.activity.updateMany({
        where: {
          ...stale,
          OR: [
            { fallbackClassification: null },
            { fallbackClassification: { not: ActivityClassification.ACTIONABLE } },
          ],
        },
        data: { classification: ActivityClassification.FYI, classificationJobType: null },
      }),
    ]);
    if (actionable.count + fyi.count > 0) {
      logger.warn('[ActivityClassificationWorker] Filed activities past the age window under their fallback label', {
        actionable: actionable.count,
        fyi: fyi.count,
      });
    }
  }

  private async claimSingleActivities(since: Date): Promise<Activity[]> {
    return claimSingleActivitiesQuery(BATCH_SIZE, since);
  }

  private async claimSpecialMentionAudienceActivities(since: Date): Promise<Activity[]> {
    return claimSpecialMentionAudienceActivitiesQuery(since);
  }

  private async processSingleActivity(activity: Activity): Promise<void> {
    try {
      // Always ends with a label: XOR, the LLM or the fallback. Only a thrown error retries.
      await activityClassificationService.classifyActivity(activity.id);
      await this.finalizeActivities([activity.id]);
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
      await this.fileUnderFallback(activities, 'missing_audience_metadata');
      return;
    }

    const activityIds = activities.map(activity => activity.id);
    const recipientUserIds = activities.map(activity => activity.userId);

    try {
      await activityClassificationService.classifySpecialMentionAudience({
        activityIds,
        messageId: first.actionSourceId,
        channelId: first.channelId,
        recipientUserIds,
      });
      const retryKey = this.getAudienceRetryKey(activities);
      await this.finalizeActivities(activityIds, retryKey ?? undefined);
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
      await this.fileUnderFallback(activities, 'missing_retry_key');
      return;
    }

    const attempts = (this.retryCounts.get(retryKey) ?? 0) + 1;
    this.retryCounts.set(retryKey, attempts);

    if (attempts > MAX_RETRIES) {
      this.retryCounts.delete(retryKey);
      await this.fileUnderFallback(activities, reason);
      return;
    }

    await db.activity.updateMany({
      where: { id: { in: activities.map(a => a.id) } },
      data: {
        classification: ActivityClassification.PENDING_CLASSIFY,
      },
    });
  }

  /** Retries ran out (or the row can't be classified): file it under its fallback label. */
  private async fileUnderFallback(activities: Activity[], reason: string): Promise<void> {
    if (activities.length === 0) return;
    const retryKey = this.getRetryKey(activities);
    if (retryKey) {
      this.retryCounts.delete(retryKey);
    }
    logger.warn('[ActivityClassificationWorker] Classification kept failing, filing under the fallback label', {
      count: activities.length,
      reason,
    });
    const isActionable = (a: Activity) => a.fallbackClassification === ActivityClassification.ACTIONABLE;
    const groups: Array<[ActivityClassification, Activity[]]> = [
      [ActivityClassification.ACTIONABLE, activities.filter(isActionable)],
      [ActivityClassification.FYI, activities.filter(a => !isActionable(a))],
    ];
    for (const [classification, rows] of groups) {
      if (rows.length === 0) continue;
      await db.activity.updateMany({
        where: { id: { in: rows.map(a => a.id) } },
        data: { classification, classificationJobType: null },
      });
    }
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
