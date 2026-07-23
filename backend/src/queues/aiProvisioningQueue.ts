import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';

export const AI_PROVISIONING_QUEUE_NAME = 'ai-provisioning';
export const AI_PROVISIONING_JOB_NAME = 'sync-ai-provisioning';

export interface AIProvisioningJobData {
  provisioningStatusId: string;
}

class AIProvisioningQueue {
  private queue: Bull.Queue<AIProvisioningJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<AIProvisioningJobData>(AI_PROVISIONING_QUEUE_NAME, {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: config.aiProvisioning.queueAttempts,
          backoff: {
            type: 'exponential',
            delay: config.aiProvisioning.queueBackoffMs,
          },
          removeOnComplete: {
            age: 60 * 60,
            count: 1000,
          },
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
      logger.info('[AI-PROVISIONING-QUEUE] Initialized');
    } catch (error) {
      logger.error('[AI-PROVISIONING-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[AI-PROVISIONING-QUEUE] Job ${job.id} failed — status ${job.data.provisioningStatusId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(
        `[AI-PROVISIONING-QUEUE] Job ${job.id} stalled — status ${job.data.provisioningStatusId}`,
      );
    });

    this.queue.on('error', err => {
      logger.error('[AI-PROVISIONING-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<AIProvisioningJobData> {
    if (!this.queue) {
      throw new Error('[AI-PROVISIONING-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  async enqueue(
    data: AIProvisioningJobData,
    options?: Bull.JobOptions,
  ): Promise<Bull.Job<AIProvisioningJobData>> {
    await this.initialize();
    return this.getQueue().add(AI_PROVISIONING_JOB_NAME, data, options);
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[AI-PROVISIONING-QUEUE] Closed');
    }
  }
}

export const aiProvisioningQueue = new AIProvisioningQueue();
