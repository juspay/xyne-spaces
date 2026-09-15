import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { TeamIntelligenceOrgSummaryQueuedJobData } from './types';

export interface TeamIntelligenceOrgSummaryQueueEnqueueResult {
  jobId: string;
  enqueued: boolean;
  duplicateJobState?: string;
}

class TeamIntelligenceOrgSummaryQueue {
  private queue: Bull.Queue<TeamIntelligenceOrgSummaryQueuedJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<TeamIntelligenceOrgSummaryQueuedJobData>('team-intelligence-org-summary', {
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
          // Org summaries are LLM-backed and may wait on long provider calls.
          // Keep the lock above the configured Team Intelligence LLM timeout.
          lockDuration: 30 * 60 * 1000,
          stalledInterval: 5 * 60 * 1000,
          maxStalledCount: 3,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[TEAM-INTEL-ORG-QUEUE] Initialized');
    } catch (error) {
      logger.error('[TEAM-INTEL-ORG-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async enqueueOrgSummaryJob(
    data: TeamIntelligenceOrgSummaryQueuedJobData
  ): Promise<TeamIntelligenceOrgSummaryQueueEnqueueResult> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[TEAM-INTEL-ORG-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.orgSummaryId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused' || state === 'completed') {
        logger.info(
          `[TEAM-INTEL-ORG-QUEUE] Skipping duplicate job orgSummaryId=${data.orgSummaryId} state=${state}`
        );
        return {
          jobId: data.orgSummaryId,
          enqueued: false,
          duplicateJobState: state,
        };
      }

      if (state === 'failed') {
        await existing.remove();
        logger.info(
          `[TEAM-INTEL-ORG-QUEUE] Removed failed job orgSummaryId=${data.orgSummaryId}, re-queuing`
        );
      }
    }

    await this.queue.add('summarize-org', data, {
      jobId: data.orgSummaryId,
    });

    logger.info('[TEAM-INTEL-ORG-QUEUE] Enqueued org summary job', {
      batchId: data.batchId,
      orgSummaryId: data.orgSummaryId,
      reportDate: data.reportDate,
    });

    return {
      jobId: data.orgSummaryId,
      enqueued: true,
    };
  }

  getQueue(): Bull.Queue<TeamIntelligenceOrgSummaryQueuedJobData> | null {
    return this.queue;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      if (!job) {
        logger.error('[TEAM-INTEL-ORG-QUEUE] Failed event received without job payload', err);
        return;
      }

      const configuredAttempts = job.opts.attempts ?? 1;
      const message =
        `[TEAM-INTEL-ORG-QUEUE] Job ${job.id} attempt ${job.attemptsMade}/${configuredAttempts} failed ` +
        `batchId=${job.data.batchId}`;
      if (job.attemptsMade >= configuredAttempts) {
        logger.error(`${message}; no attempts remain:`, err);
      } else {
        logger.warn(`${message}; retry scheduled:`, err);
      }
    });

    this.queue.on('stalled', (job) => {
      if (!job) {
        logger.warn('[TEAM-INTEL-ORG-QUEUE] Stalled event received without job payload');
        return;
      }

      logger.warn(`[TEAM-INTEL-ORG-QUEUE] Job ${job.id} stalled batchId=${job.data.batchId}`);
    });

    this.queue.on('error', (err) => {
      logger.error('[TEAM-INTEL-ORG-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[TEAM-INTEL-ORG-QUEUE] Closed');
    }
  }
}

export const teamIntelligenceOrgSummaryQueue = new TeamIntelligenceOrgSummaryQueue();
