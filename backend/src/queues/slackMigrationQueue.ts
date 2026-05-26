/**
 * Slack Migration Nightly Queue
 *
 * Bull queue for processing channel migrations kicked off by the nightly cron.
 * One job per channel per night.
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export const SLACK_MIGRATION_QUEUE_NAME = 'slack-migration-nightly';

export interface SlackMigrationJobData {
  /** 1-based row index in the Google Sheet for writeback */
  rowIndex: number;
  slackChannelName: string; // human-readable name for logs/accountability
  slackChannelId: string;
  xyneChannelId: string;
  /**
   * ISO date string YYYY-MM-DD — start of the sync window.
   * For daily rows this is yesterday's date.
   * For one-time rows this is the date from the sheet.
   */
  syncDate: string;
  /**
   * ISO date string YYYY-MM-DD — end of the sync window (inclusive).
   * For daily rows this is also yesterday, so the window is exactly one day.
   * For one-time rows this is undefined (open-ended up to now).
   */
  syncEndDate?: string;
  postNotification: boolean;
  isDaily: boolean;
  /** The IST date string (dd-mm-yyyy) for the nightly run, used in status label */
  runDate: string;
}

class SlackMigrationQueue {
  private queue: Bull.Queue<SlackMigrationJobData> | null = null;

  get(): Bull.Queue<SlackMigrationJobData> {
    if (this.queue) return this.queue;

    this.queue = new Bull<SlackMigrationJobData>(SLACK_MIGRATION_QUEUE_NAME, {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: false, // keep failed jobs visible
      },
      settings: {
        // channels can take up to 30 min to migrate
        lockDuration: 35 * 60 * 1000,
        stalledInterval: 60 * 1000,
        maxStalledCount: 1,
      },
    });

    this.queue.on('error', (err) => {
      logger.error(`[SLACK-MIGRATION-QUEUE] Error: ${err.message}`);
    });

    this.queue.on('failed', (job, err) => {
      logger.error(`[SLACK-MIGRATION-QUEUE] Job ${job.id} failed: ${err.message}`, {
        channelId: job.data.slackChannelId,
      });
    });

    logger.info('[SLACK-MIGRATION-QUEUE] Initialized');
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

const slackMigrationQueueInstance = new SlackMigrationQueue();

export function getSlackMigrationQueue(): Bull.Queue<SlackMigrationJobData> {
  return slackMigrationQueueInstance.get();
}

export async function closeSlackMigrationQueue(): Promise<void> {
  await slackMigrationQueueInstance.close();
}
