import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface XPostTldrJobData {
  messageId: string;
  conversationId: string;
  postId: string;
}

/**
 * Background AI TLDR for X post link previews. Never on the message send path:
 * the preview is written as `tldrStatus: pending` and this job fills it in.
 */
class XPostTldrQueue {
  private queue: Bull.Queue<XPostTldrJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<XPostTldrJobData>('x-post-tldr', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
        settings: {
          lockDuration: 2 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[X-POST-TLDR-QUEUE] Initialized');
    } catch (error) {
      logger.error('[X-POST-TLDR-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(`[X-POST-TLDR-QUEUE] Job ${job.id} failed — message ${job.data.messageId}:`, err);
    });

    this.queue.on('stalled', job => {
      logger.warn(`[X-POST-TLDR-QUEUE] Job ${job.id} stalled — message ${job.data.messageId}`);
    });

    this.queue.on('error', err => {
      logger.error('[X-POST-TLDR-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<XPostTldrJobData> {
    if (!this.queue) {
      throw new Error('[X-POST-TLDR-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[X-POST-TLDR-QUEUE] Closed');
    }
  }
}

export const xPostTldrQueue = new XPostTldrQueue();
