import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface EmailFetchJobData {
  sourceId: string;
  channelId: string;
  requesterUserId: string;
  workspaceId: string;
  startDate?: string;
  endDate?: string;
  targetChannelId?: string;
  dlEmail?: string;
  isDlMemberSync?: boolean;
}

export interface ReconnectCatchupJobData {
  sourceId: string;
  watchHistoryId: string;
  requesterUserId?: string;
}

export type EmailFetchQueueJobData = EmailFetchJobData | ReconnectCatchupJobData;

class EmailFetchQueue {
  private queue: Bull.Queue<EmailFetchQueueJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<EmailFetchQueueJobData>('email-fetch', {
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
          lockDuration: 10 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[EMAIL-FETCH-QUEUE] Initialized');
    } catch (error) {
      logger.error('[EMAIL-FETCH-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[EMAIL-FETCH-QUEUE] Job ${job.id} failed — source ${job.data.sourceId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[EMAIL-FETCH-QUEUE] Job ${job.id} stalled`);
    });

    this.queue.on('error', err => {
      logger.error('[EMAIL-FETCH-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<EmailFetchQueueJobData> {
    if (!this.queue) {
      throw new Error('[EMAIL-FETCH-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[EMAIL-FETCH-QUEUE] Closed');
    }
  }
}

export const emailFetchQueue = new EmailFetchQueue();

export async function enqueueReconnectCatchup(params: ReconnectCatchupJobData): Promise<void> {
  try {
    if (!emailFetchQueue.isReady) await emailFetchQueue.initialize();
    await emailFetchQueue.getQueue().add(
      'reconnect-catchup',
      params,
      { jobId: `catchup:${params.sourceId}` },
    );
    logger.info('[EMAIL-FETCH-QUEUE] Queued reconnect catch-up', { sourceId: params.sourceId });
  } catch (error) {
    logger.error('[EMAIL-FETCH-QUEUE] Failed to queue reconnect catch-up', {
      sourceId: params.sourceId,
      error,
    });
  }
}
