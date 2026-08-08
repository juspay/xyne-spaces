import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export interface SdlcWorkJobData {
  executionId: string;
}

class SdlcWorkQueue {
  private queue: Bull.Queue<SdlcWorkJobData> | null = null;

  async initialize(): Promise<void> {
    if (this.queue) return;
    this.queue = new Bull<SdlcWorkJobData>('sdlc-work', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
      settings: {
        lockDuration: 60 * 60 * 1000,
        stalledInterval: 60_000,
        maxStalledCount: 1,
      },
    });
    this.queue.on('error', error => logger.error('[SDLC-WORK-QUEUE] error', error));
    logger.info('[SDLC-WORK-QUEUE] Initialized');
  }

  async enqueue(executionId: string): Promise<void> {
    if (!this.queue) await this.initialize();
    const existing = await this.queue!.getJob(executionId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') return;
      await existing.remove();
    }
    await this.queue!.add({ executionId }, { jobId: executionId });
  }

  getQueue(): Bull.Queue<SdlcWorkJobData> | null {
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const sdlcWorkQueue = new SdlcWorkQueue();
