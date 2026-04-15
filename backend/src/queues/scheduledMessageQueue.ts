import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface ScheduledMessageJobData {
  messageId: string;
  channelId: string;
}

class ScheduledMessageQueue {
  private queue: Bull.Queue<ScheduledMessageJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<ScheduledMessageJobData>('scheduled-messages', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 30000,
          stalledInterval: 30000,
          maxStalledCount: 2,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[SCHEDULED-MESSAGE-QUEUE] Initialized');

      // Log existing repeatable jobs for debugging
      const existingJobs = await this.queue.getRepeatableJobs();
      logger.info(
        `[SCHEDULED-MESSAGE-QUEUE] Found ${existingJobs.length} existing repeatable job(s)`,
      );
      existingJobs.forEach(job => {
        const nextRun = new Date(job.next);
        const nextRunIST = nextRun.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        logger.info(`  - Job ${job.id}: cron="${job.cron}", next run: ${nextRunIST} IST`);
      });
    } catch (error) {
      logger.error('[SCHEDULED-MESSAGE-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[SCHEDULED-MESSAGE-QUEUE] Job ${job.id} failed — message ${job.data.messageId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[SCHEDULED-MESSAGE-QUEUE] Job ${job.id} stalled`);
    });

    this.queue.on('error', err => {
      logger.error('[SCHEDULED-MESSAGE-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<ScheduledMessageJobData> {
    if (!this.queue) {
      throw new Error(
        '[SCHEDULED-MESSAGE-QUEUE] Queue not initialized — call initialize() first',
      );
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[SCHEDULED-MESSAGE-QUEUE] Closed');
    }
  }
}

export const scheduledMessageQueue = new ScheduledMessageQueue();
