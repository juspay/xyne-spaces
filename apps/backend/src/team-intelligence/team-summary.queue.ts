import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { TeamIntelligenceTeamSummaryQueuedJobData } from './types';

export interface TeamIntelligenceTeamSummaryQueueEnqueueResult {
  jobId: string;
  enqueued: boolean;
  duplicateJobState?: string;
}

class TeamIntelligenceTeamSummaryQueue {
  private queue: Bull.Queue<TeamIntelligenceTeamSummaryQueuedJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<TeamIntelligenceTeamSummaryQueuedJobData>('team-intelligence-team-summary', {
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
          // Team summaries are LLM-backed and may wait on long provider calls.
          // Keep the lock above the configured Team Intelligence LLM timeout.
          lockDuration: 30 * 60 * 1000,
          stalledInterval: 5 * 60 * 1000,
          maxStalledCount: 3,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[TEAM-INTEL-TEAM-QUEUE] Initialized');
    } catch (error) {
      logger.error('[TEAM-INTEL-TEAM-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  async enqueueTeamSummaryJob(
    data: TeamIntelligenceTeamSummaryQueuedJobData
  ): Promise<TeamIntelligenceTeamSummaryQueueEnqueueResult> {
    if (!this.queue || !this.isInitialized) {
      throw new Error('[TEAM-INTEL-TEAM-QUEUE] Queue not initialized');
    }

    const existing = await this.queue.getJob(data.teamSummaryId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused' || state === 'completed') {
        logger.info(
          `[TEAM-INTEL-TEAM-QUEUE] Skipping duplicate job teamSummaryId=${data.teamSummaryId} state=${state}`
        );
        return {
          jobId: data.teamSummaryId,
          enqueued: false,
          duplicateJobState: state,
        };
      }

      if (state === 'failed') {
        await existing.remove();
        logger.info(
          `[TEAM-INTEL-TEAM-QUEUE] Removed failed job teamSummaryId=${data.teamSummaryId}, re-queuing`
        );
      }
    }

    await this.queue.add('summarize-team', data, {
      jobId: data.teamSummaryId,
    });

    logger.info('[TEAM-INTEL-TEAM-QUEUE] Enqueued team summary job', {
      batchId: data.batchId,
      teamSummaryId: data.teamSummaryId,
      teamId: data.teamId,
      teamName: data.teamName,
    });

    return {
      jobId: data.teamSummaryId,
      enqueued: true,
    };
  }

  getQueue(): Bull.Queue<TeamIntelligenceTeamSummaryQueuedJobData> | null {
    return this.queue;
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      if (!job) {
        logger.error('[TEAM-INTEL-TEAM-QUEUE] Failed event received without job payload', err);
        return;
      }

      const configuredAttempts = job.opts.attempts ?? 1;
      const message =
        `[TEAM-INTEL-TEAM-QUEUE] Job ${job.id} attempt ${job.attemptsMade}/${configuredAttempts} failed ` +
        `batchId=${job.data.batchId} teamName=${job.data.teamName}`;
      if (job.attemptsMade >= configuredAttempts) {
        logger.error(`${message}; no attempts remain:`, err);
      } else {
        logger.warn(`${message}; retry scheduled:`, err);
      }
    });

    this.queue.on('stalled', (job) => {
      if (!job) {
        logger.warn('[TEAM-INTEL-TEAM-QUEUE] Stalled event received without job payload');
        return;
      }

      logger.warn(`[TEAM-INTEL-TEAM-QUEUE] Job ${job.id} stalled batchId=${job.data.batchId}`);
    });

    this.queue.on('error', (err) => {
      logger.error('[TEAM-INTEL-TEAM-QUEUE] Queue error:', err);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[TEAM-INTEL-TEAM-QUEUE] Closed');
    }
  }
}

export const teamIntelligenceTeamSummaryQueue = new TeamIntelligenceTeamSummaryQueue();
