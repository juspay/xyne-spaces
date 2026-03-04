import Bull from 'bull';
import { logger } from '@/utils/logger';
import { nudgeEvaluationEngine } from '@/nudges/engine';
import { registerAllNudgeDefinitions } from '@/nudges/definitions';
import { redisService } from '@/services/redisService';
import type { ActivityEventNudgePayload } from '@/nudges/types';

const PROACTIVE_NUDGE_QUEUE_NAME = 'proactive-nudge';
const PROACTIVE_NUDGE_JOB_NAME = 'generate-nudges';

export type ProactiveNudgeJobData = {
  userId: string;
  sessionId: string;
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url: string;
  triggerType: string;
  contextMetadata?: Record<string, unknown>;
  platform: string;
  timestamp: number;
};

class ProactiveNudgeWorker {
  private queue: Bull.Queue<ProactiveNudgeJobData> | null = null;
  private queuePromise: Promise<Bull.Queue<ProactiveNudgeJobData>> | null = null;
  private isProcessorRegistered = false;
  private isInitialized = false;

  private async getQueue(): Promise<Bull.Queue<ProactiveNudgeJobData>> {
    if (this.queue) return this.queue;
    if (this.queuePromise) return this.queuePromise;

    this.queuePromise = (async () => {
      const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

      const queue = new Bull<ProactiveNudgeJobData>(PROACTIVE_NUDGE_QUEUE_NAME, {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
        settings: {
          stalledInterval: 30 * 1000,
          maxStalledCount: 1,
        },
      });

      this.queue = queue;
      return queue;
    })();

    try {
      return await this.queuePromise;
    } finally {
      this.queuePromise = null;
    }
  }

  async enqueue(data: ProactiveNudgeJobData): Promise<Bull.Job<ProactiveNudgeJobData>> {
    const queue = await this.getQueue();
    const jobId = `nudge-${data.eventCategory}-${data.eventName}-${data.timestamp}-${data.userId}`;
    return queue.add(PROACTIVE_NUDGE_JOB_NAME, data, { jobId });
  }

  async start(): Promise<void> {
    if (this.isInitialized) return;

    registerAllNudgeDefinitions();

    const queue = await this.getQueue();
    if (!this.isProcessorRegistered) {
      queue.process(PROACTIVE_NUDGE_JOB_NAME, 3, async (job) => {
        return this.processJob(job);
      });
      this.isProcessorRegistered = true;
    }

    this.isInitialized = true;
    logger.info('[ProactiveNudgeWorker] Started');
  }

  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.queuePromise = null;
    this.isProcessorRegistered = false;
    this.isInitialized = false;
    logger.info('[ProactiveNudgeWorker] Shut down');
  }

  private async processJob(job: Bull.Job<ProactiveNudgeJobData>): Promise<void> {
    const data = job.data;

    try {
      const payload: ActivityEventNudgePayload = {
        userId: data.userId,
        sessionId: data.sessionId,
        eventCategory: data.eventCategory,
        eventName: data.eventName,
        eventLabel: data.eventLabel,
        url: data.url,
        triggerType: data.triggerType,
        contextMetadata: data.contextMetadata,
        platform: data.platform,
        timestamp: new Date(data.timestamp),
      };

      await nudgeEvaluationEngine.evaluateActivityEvent(payload);
    } catch (error) {
      logger.error('[ProactiveNudgeWorker] Job failed', {
        eventCategory: data.eventCategory,
        eventName: data.eventName,
        userId: data.userId,
        attemptsMade: job.attemptsMade,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const proactiveNudgeWorker = new ProactiveNudgeWorker();
