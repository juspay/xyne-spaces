import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export interface SdlcAccessCheckJobData {
  repoId: string;
  workspaceId: string;
  userId: string;
}

class SdlcAccessCheckQueue {
  private queue: Bull.Queue<SdlcAccessCheckJobData> | null = null;

  async initialize(): Promise<void> {
    if (this.queue) return;
    this.queue = new Bull<SdlcAccessCheckJobData>('sdlc-access-check', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    this.queue.on('error', (error) => logger.error('[SDLC-ACCESS-CHECK-QUEUE] error', error));
  }

  async enqueue(data: SdlcAccessCheckJobData): Promise<void> {
    if (!this.queue) await this.initialize();
    const existing = await this.queue!.getJob(data.repoId);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'delayed'].includes(state)) return;
      await existing.remove();
    }
    await this.queue!.add(data, { jobId: data.repoId });
  }

  getQueue(): Bull.Queue<SdlcAccessCheckJobData> | null {
    return this.queue;
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
  }
}

export const sdlcAccessCheckQueue = new SdlcAccessCheckQueue();
