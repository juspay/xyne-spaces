import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface DelayedMessageJobData {
  delayedMessageId: string;
  channelId: string;
  conversationId?: string | null;
  senderId: string;
  content: string;
  hasAttachment: boolean;
  scheduledFor: number;
}

class DelayedMessageQueue {
  private queue: Bull.Queue<DelayedMessageJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<DelayedMessageJobData>('delayed-messages', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 60000,     // 1 min
          stalledInterval: 30000,  // 30 sec
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[DELAYED-MSG-QUEUE] Initialized');
    } catch (err) {
      logger.error('[DELAYED-MSG-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Add a delayed job that fires at the given Unix-ms timestamp.
   */
  async scheduleMessage(data: DelayedMessageJobData): Promise<void> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[DELAYED-MSG-QUEUE] Queue not initialized');
    }

    const delayMs = Math.max(0, data.scheduledFor - Date.now());

    const job = await this.queue.add(data, {
      jobId: data.delayedMessageId,
      delay: delayMs,
    });

    logger.info(
      `[DELAYED-MSG-QUEUE] Enqueued job id=${job.id} delayedMessageId=${data.delayedMessageId} delayMs=${delayMs}`,
    );

  }

  /** Remove a delayed job before it fires (on cancellation). */
  async cancelMessage(delayedMessageId: string): Promise<void> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[DELAYED-MSG-QUEUE] Queue not initialized');
    }

    const job = await this.queue.getJob(delayedMessageId);
    if (job) {
      await job.remove();
      logger.info(`[DELAYED-MSG-QUEUE] Cancelled job delayedMessageId=${delayedMessageId}`);
    } else {
      logger.warn(
        `[DELAYED-MSG-QUEUE] Job delayedMessageId=${delayedMessageId} not found (already processed or removed)`,
      );
    }
  }

  getQueue(): Bull.Queue<DelayedMessageJobData> | null {
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[DELAYED-MSG-QUEUE] Job ${job.id} failed delayedMessageId=${job.data.delayedMessageId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(
        `[DELAYED-MSG-QUEUE] Job ${job.id} stalled delayedMessageId=${job.data.delayedMessageId}`,
      );
    });

    this.queue.on('error', err => {
      logger.error('[DELAYED-MSG-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[DELAYED-MSG-QUEUE] Closed');
    }
  }
}

export const delayedMessageQueue = new DelayedMessageQueue();
