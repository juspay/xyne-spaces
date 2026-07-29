import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface AutoDraftJobData {
  ticketId: string;
  conversationId: string;
  channelId: string;
}

class AutoDraftQueue {
  private queue: Bull.Queue<AutoDraftJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<AutoDraftJobData>('auto-draft', {
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
          lockDuration: 5 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[AUTO-DRAFT-QUEUE] Initialized');
    } catch (error) {
      logger.error('[AUTO-DRAFT-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(`[AUTO-DRAFT-QUEUE] Job ${job.id} failed — ticket ${job.data.ticketId}:`, err);
    });

    this.queue.on('stalled', job => {
      logger.warn(`[AUTO-DRAFT-QUEUE] Job ${job.id} stalled — ticket ${job.data.ticketId}`);
    });

    this.queue.on('error', err => {
      logger.error('[AUTO-DRAFT-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<AutoDraftJobData> {
    if (!this.queue) {
      throw new Error('[AUTO-DRAFT-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[AUTO-DRAFT-QUEUE] Closed');
    }
  }
}

export const autoDraftQueue = new AutoDraftQueue();
