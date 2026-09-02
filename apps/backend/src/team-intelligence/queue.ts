import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { TeamIntelligenceQueuedJobData } from './types';

export interface TeamIntelligenceQueueEnqueueResult {
  jobId: string;
  enqueued: boolean;
  duplicateJobState?: string;
}

class TeamIntelligenceQueue {
  private queue: Bull.Queue<TeamIntelligenceQueuedJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<TeamIntelligenceQueuedJobData>('team-intelligence-user-ingestion', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { count: 100 },
        },
        settings: {
          // LLM-backed user-summary jobs can legitimately run longer than a
          // normal queue task, especially when large evidence is chunked.
          // Keep the lock above the configured Team Intelligence LLM timeout so
          // Bull does not lose ownership while a healthy worker is waiting on I/O.
          lockDuration: 30 * 60 * 1000,
          stalledInterval: 5 * 60 * 1000,
          maxStalledCount: 3,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[TEAM-INTEL-QUEUE] Initialized');
    } catch (error) {
      logger.error('[TEAM-INTEL-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async enqueueUserIngestionJob(
    data: TeamIntelligenceQueuedJobData
  ): Promise<TeamIntelligenceQueueEnqueueResult> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[TEAM-INTEL-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.userIngestionId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused') {
        logger.info(
          `[TEAM-INTEL-QUEUE] Skipping duplicate job userIngestionId=${data.userIngestionId} state=${state}`
        );
        return {
          jobId: data.userIngestionId,
          enqueued: false,
          duplicateJobState: state,
        };
      }

      if (state === 'failed' || state === 'completed') {
        await existing.remove();
        logger.info(
          `[TEAM-INTEL-QUEUE] Removed ${state} job userIngestionId=${data.userIngestionId}, re-queuing`
        );
      }
    }

    await this.queue.add('ingest-user', data, {
      jobId: data.userIngestionId,
    });

    logger.info('[TEAM-INTEL-QUEUE] Enqueued user ingestion job', {
      batchId: data.batchId,
      userIngestionId: data.userIngestionId,
      userEmail: data.userEmail,
    });

    return {
      jobId: data.userIngestionId,
      enqueued: true,
    };
  }

  getQueue(): Bull.Queue<TeamIntelligenceQueuedJobData> | null {
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      if (!job) {
        logger.error('[TEAM-INTEL-QUEUE] Failed event received without job payload', err);
        return;
      }

      const configuredAttempts = job.opts.attempts ?? 1;
      const message =
        `[TEAM-INTEL-QUEUE] Job ${job.id} attempt ${job.attemptsMade}/${configuredAttempts} failed ` +
        `batchId=${job.data.batchId} userEmail=${job.data.userEmail}`;
      if (job.attemptsMade >= configuredAttempts) {
        logger.error(`${message}; no attempts remain:`, err);
      } else {
        logger.warn(`${message}; retry scheduled:`, err);
      }
    });

    this.queue.on('stalled', (job) => {
      if (!job) {
        logger.warn('[TEAM-INTEL-QUEUE] Stalled event received without job payload');
        return;
      }

      logger.warn(`[TEAM-INTEL-QUEUE] Job ${job.id} stalled batchId=${job.data.batchId}`);
    });

    this.queue.on('error', (err) => {
      logger.error('[TEAM-INTEL-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[TEAM-INTEL-QUEUE] Closed');
    }
  }
}

export const teamIntelligenceQueue = new TeamIntelligenceQueue();
