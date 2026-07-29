import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface IngestTableSelection {
  schemaName: string;
  tableName: string;
}

export interface DataSourceIngestJobData {
  dataSourceId: string;
  includedTables?: IngestTableSelection[];
}

class DataSourceIngestQueue {
  private queue: Bull.Queue<DataSourceIngestJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<DataSourceIngestJobData>('data-source-ingest', {
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
          lockDuration: 300_000,    // 5 min
          stalledInterval: 30_000,  // 30 sec
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[DS-INGEST-QUEUE] Initialized');
    } catch (err) {
      logger.error('[DS-INGEST-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async addJob(data: DataSourceIngestJobData): Promise<void> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[DS-INGEST-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.dataSourceId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused') {
        logger.info(`[DS-INGEST-QUEUE] Skipping duplicate job dataSourceId=${data.dataSourceId} state=${state}`);
        return;
      }
      if (state === 'failed' || state === 'stuck' || state === 'completed') {
        await existing.remove();
        logger.info(`[DS-INGEST-QUEUE] Removed ${state} job dataSourceId=${data.dataSourceId}, re-queuing`);
      }
    }

    await this.queue.add(data, { jobId: data.dataSourceId });
    logger.info(`[DS-INGEST-QUEUE] Enqueued job dataSourceId=${data.dataSourceId}`);
  }

  getQueue(): Bull.Queue<DataSourceIngestJobData> | null {
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[DS-INGEST-QUEUE] Job ${job.id} failed dataSourceId=${job.data.dataSourceId}:`,
        err,
      );
    });

    this.queue.on('stalled', (job) => {
      logger.warn(
        `[DS-INGEST-QUEUE] Job ${job.id} stalled dataSourceId=${job.data.dataSourceId}`,
      );
    });

    this.queue.on('error', (err) => {
      logger.error('[DS-INGEST-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[DS-INGEST-QUEUE] Closed');
    }
  }
}

export const dataSourceIngestQueue = new DataSourceIngestQueue();
