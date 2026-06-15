import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface EmailClassificationJobData {
  ticketId: string;
  channelId: string;
  emailId: string;
  groupId: string | null;
}

class EmailClassificationQueue {
  private queue: Bull.Queue<EmailClassificationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<EmailClassificationJobData>('email-classification', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 2 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[EMAIL-CLASSIFICATION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[EMAIL-CLASSIFICATION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[EMAIL-CLASSIFICATION-QUEUE] Job ${job.id} failed — ticket ${job.data.ticketId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[EMAIL-CLASSIFICATION-QUEUE] Job ${job.id} stalled — ticket ${job.data.ticketId}`);
    });

    this.queue.on('error', err => {
      logger.error('[EMAIL-CLASSIFICATION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<EmailClassificationJobData> {
    if (!this.queue) {
      throw new Error('[EMAIL-CLASSIFICATION-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[EMAIL-CLASSIFICATION-QUEUE] Closed');
    }
  }
}

export const emailClassificationQueue = new EmailClassificationQueue();
