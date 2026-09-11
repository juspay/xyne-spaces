import Bull from 'bull';
import { config } from '@/config/env';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { sdlcAdmission } from './sdlcAdmission';

export type SdlcJobData = {
  type: 'SETUP' | 'WORK' | 'WIKI';
  repoId: string;
  executionId: string;
  capacityBlockedAt?: number;
};

const jobIdFor = (data: SdlcJobData): string =>
  `${data.type.toLowerCase()}:${data.executionId}`;

class SdlcQueue {
  private queue: Bull.Queue<SdlcJobData> | null = null;

  async initialize(): Promise<void> {
    if (this.queue) return;
    this.queue = new Bull<SdlcJobData>('sdlc', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: {
        attempts: Math.ceil(config.sdlcCapacityWaitTimeoutMs / config.sdlcCapacityRetryDelayMs) + 2,
        backoff: { type: 'sdlc-capacity' },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
      settings: {
        backoffStrategies: {
          'sdlc-capacity': (_attemptsMade, error) =>
            error.name === 'SdlcCapacityError'
              ? config.sdlcCapacityRetryDelayMs +
                Math.floor(Math.random() * Math.min(5_000, config.sdlcCapacityRetryDelayMs / 2))
              : 2_000,
        },
        lockDuration: 60 * 60 * 1000,
        stalledInterval: 60_000,
        maxStalledCount: 1,
      },
    });
    this.queue.on('error', (error) => logger.error('[SDLC-QUEUE] error', error));
    logger.info('[SDLC-QUEUE] Initialized');
  }

  private async enqueue(data: SdlcJobData): Promise<void> {
    if (!this.queue) await this.initialize();
    const jobId = jobIdFor(data);
    const existing = await this.queue!.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'delayed'].includes(state)) return;
      await existing.remove();
    }
    await sdlcAdmission.registerPending(data.repoId, jobId);
    try {
      await this.queue!.add(data, { jobId });
    } catch (error) {
      await sdlcAdmission.unregisterPending(data.repoId, jobId);
      throw error;
    }
  }

  async enqueueSetup(executionId: string, repoId: string): Promise<void> {
    await this.enqueue({ type: 'SETUP', executionId, repoId });
  }

  async enqueueWork(executionId: string, repoId: string): Promise<void> {
    await this.enqueue({ type: 'WORK', executionId, repoId });
  }

  async enqueueWiki(executionId: string, repoId: string): Promise<void> {
    await this.enqueue({ type: 'WIKI', executionId, repoId });
  }

  getQueue(): Bull.Queue<SdlcJobData> | null {
    return this.queue;
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
  }
}

export const sdlcQueue = new SdlcQueue();
