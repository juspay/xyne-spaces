import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { ConversationSource } from '@/services/conversationIngestion/types';

export interface ConversationIngestJobData {
  // Full GCS URI: gs://bucket-name/path/to/file.json
  gcsUri: string;
  source: ConversationSource;
  sourceId: string;
}

class ConversationIngestQueue {
  private queue: Bull.Queue<ConversationIngestJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<ConversationIngestJobData>('conversation-ingest', {
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
          lockDuration: 60000,      // 1 min
          stalledInterval: 30000,   // 30 sec
          maxStalledCount: 1,
        }
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[CONV-INGEST-QUEUE] Initialized');
    } catch (err) {
      logger.error('[CONV-INGEST-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async addJob(data: ConversationIngestJobData): Promise<void> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[CONV-INGEST-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.sourceId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused') {
        logger.info(`[CONV-INGEST-QUEUE] Skipping duplicate job sourceId=${data.sourceId} state=${state}`);
        return;
      }
      if (state === 'failed' || state === 'stuck' || state === 'completed') {
        await existing.remove();
        logger.info(`[CONV-INGEST-QUEUE] Removed ${state} job sourceId=${data.sourceId}, re-queuing with fresh data`);
      }
    }

    await this.queue.add(data, { jobId: data.sourceId });
    logger.info(`[CONV-INGEST-QUEUE] Enqueued job source=${data.source} sourceId=${data.sourceId} gcsUri=${data.gcsUri}`);
  }

  getQueue(): Bull.Queue<ConversationIngestJobData> | null {
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(`[CONV-INGEST-QUEUE] Job ${job.id} failed source=${job.data.source} sourceId=${job.data.sourceId} gcsUri=${job.data.gcsUri}:`, err);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[CONV-INGEST-QUEUE] Job ${job.id} stalled source=${job.data.source} sourceId=${job.data.sourceId}`);
    });

    this.queue.on('error', (err) => {
      logger.error('[CONV-INGEST-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[CONV-INGEST-QUEUE] Closed');
    }
  }
}

export const conversationIngestQueue = new ConversationIngestQueue();
