import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface DocumentIngestJobData {
  // Full GCS URI: gs://bucket-name/path/to/file.txt
  gcsUri: string;
  userId: string;
  sessionId: string;
  originalFilename: string;
  repoUrl: string;
}

class DocumentIngestQueue {
  private queue: Bull.Queue<DocumentIngestJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<DocumentIngestJobData>('document-ingest', {
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
          lockDuration: 120000,   // 2 min (documents can be larger)
          stalledInterval: 30000, // 30 sec
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[DOC-INGEST-QUEUE] Initialized');
    } catch (err) {
      logger.error('[DOC-INGEST-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async addJob(data: DocumentIngestJobData): Promise<void> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[DOC-INGEST-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.sessionId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'delayed' || state === 'paused') {
        logger.info(`[DOC-INGEST-QUEUE] Skipping duplicate job sessionId=${data.sessionId} state=${state}`);
        return;
      }
      if (state === 'failed' || state === 'completed') {
        await existing.remove();
        logger.info(`[DOC-INGEST-QUEUE] Removed ${state} job sessionId=${data.sessionId}, re-queuing`);
      }
    }

    await this.queue.add(data, { jobId: data.sessionId });
    logger.info(`[DOC-INGEST-QUEUE] Enqueued job sessionId=${data.sessionId} file=${data.originalFilename}`);
  }

  getQueue(): Bull.Queue<DocumentIngestJobData> | null {
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[DOC-INGEST-QUEUE] Job ${job.id} failed sessionId=${job.data.sessionId} file=${job.data.originalFilename}:`,
        err,
      );
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[DOC-INGEST-QUEUE] Job ${job.id} stalled sessionId=${job.data.sessionId}`);
    });

    this.queue.on('error', (err) => {
      logger.error('[DOC-INGEST-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[DOC-INGEST-QUEUE] Closed');
    }
  }
}

export const documentIngestQueue = new DocumentIngestQueue();
