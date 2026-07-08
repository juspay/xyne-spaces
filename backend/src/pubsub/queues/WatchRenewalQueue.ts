/**
 * Unified Watch Renewal Queue
 *
 * Single Bull queue that renews ALL watch/subscription types:
 * - Gmail watches (via Pub/Sub)
 * - Google Calendar webhook watches
 * - Microsoft Calendar webhook subscriptions
 *
 * Replaces: gmailWatchRenewalQueue.ts + calendarRenewalQueue.ts
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { pubSubWatchService } from '../index';

const TAG = '[WatchRenewalQueue]';

type RenewalConfig = { cron: string; defaultCron: string; withinMs: number };
type RenewalJobData = { providerType: string };

// Renewal schedules per provider (cron expressions)
const RENEWAL_CONFIGS: Record<string, RenewalConfig> = {
  gmail: {
    cron: process.env.GMAIL_WATCH_RENEWAL_CRON || '0 3 * * *',
    defaultCron: '0 3 * * *',
    withinMs: 24 * 60 * 60 * 1000, // Renew daily (idempotent)
  },
  'google-calendar': {
    cron: process.env.CALENDAR_RENEWAL_CRON || '0 2 * * *',
    defaultCron: '0 2 * * *',
    withinMs: 2 * 24 * 60 * 60 * 1000, // Renew within 2 days
  },
  'microsoft-calendar': {
    cron: process.env.CALENDAR_RENEWAL_CRON || '0 2 * * *',
    defaultCron: '0 2 * * *',
    withinMs: 2 * 24 * 60 * 60 * 1000, // Renew within 2 days
  },
};

class WatchRenewalQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('watch-renewal', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  private async runProviderRenewal(providerType: string): Promise<{
    renewed: number;
    failed: number;
    deactivated: number;
  }> {
    const config = RENEWAL_CONFIGS[providerType];
    if (!config) {
      logger.warn(`${TAG} No renewal config for provider`, { providerType });
      return { renewed: 0, failed: 0, deactivated: 0 };
    }

    try {
      return await pubSubWatchService.renewAllExpiring(providerType, config.withinMs);
    } catch (err) {
      logger.error(`${TAG} Unexpected error renewing provider`, {
        providerType,
        error: err instanceof Error ? err.message : String(err),
      });
      return { renewed: 0, failed: 0, deactivated: 0 };
    }
  }

  async initialize(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) return;

    queue.process('renew-provider', async (job) => {
      const { providerType } = job.data as RenewalJobData;
      logger.info(`${TAG} Starting provider renewal`, { providerType });
      const startedAt = Date.now();
      const result = await this.runProviderRenewal(providerType);
      logger.info(`${TAG} Provider renewal complete`, {
        providerType,
        durationMs: Date.now() - startedAt,
        result,
      });
    });

    // Backward-compatible processor for stale queued jobs from the old single-cron setup.
    queue.process('renew-all', async () => {
      logger.info(`${TAG} Starting renewal cycle`);
      const startedAt = Date.now();

      const results: Record<string, { renewed: number; failed: number; deactivated: number }> = {};

      for (const providerType of pubSubWatchService.getRegisteredTypes()) {
        results[providerType] = await this.runProviderRenewal(providerType);
      }

      logger.info(`${TAG} Renewal cycle complete`, {
        durationMs: Date.now() - startedAt,
        results,
      });
    });

    queue.on('failed', (job, err) => {
      logger.error(`${TAG} Job failed`, {
        jobName: job.name,
        jobId: job.id,
        error: err.message,
      });
    });

    queue.on('error', (err) => {
      logger.error(`${TAG} Queue error`, err);
    });

    // Clean up repeatable jobs and re-register (handles env changes)
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'renew-all' || job.name === 'renew-provider') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    const registeredTypes = pubSubWatchService.getRegisteredTypes();
    for (const providerType of registeredTypes) {
      const config = RENEWAL_CONFIGS[providerType];
      if (!config) {
        logger.warn(`${TAG} Skipping provider without renewal config`, { providerType });
        continue;
      }

      const jobId = `watch-renewal-${providerType}-repeatable`;
      try {
        await queue.add(
          'renew-provider',
          { providerType },
          {
            repeat: { cron: config.cron },
            jobId,
          },
        );
      } catch (err) {
        logger.error(`${TAG} Failed to register provider cron, falling back to default`, {
          providerType,
          cron: config.cron,
          defaultCron: config.defaultCron,
          error: err instanceof Error ? err.message : String(err),
        });
        await queue.add(
          'renew-provider',
          { providerType },
          {
            repeat: { cron: config.defaultCron },
            jobId,
          },
        );
      }

      // Delayed first run so we don't race with boot.
      await queue.add(
        'renew-provider',
        { providerType },
        {
          delay: 30_000,
          jobId: `watch-renewal-${providerType}-initial`,
        },
      );
    }

    this.workerInitialized = true;
    logger.info(
      `${TAG} Queue initialized, providers: [${pubSubWatchService
        .getRegisteredTypes()
        .join(', ')}]`
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.workerInitialized = false;
  }
}

export const watchRenewalQueue = new WatchRenewalQueue();
