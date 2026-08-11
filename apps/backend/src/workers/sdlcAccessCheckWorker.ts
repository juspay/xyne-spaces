import type Bull from 'bull';
import {
  sdlcAccessCheckQueue,
  type SdlcAccessCheckJobData,
} from '@/queues/sdlcAccessCheckQueue';
import { sdlcVcs } from '@/sdlc/vcs/SdlcVcsService';
import { logger } from '@/utils/logger';

class SdlcAccessCheckWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    await sdlcAccessCheckQueue.initialize();
    const queue = sdlcAccessCheckQueue.getQueue();
    if (!queue) throw new Error('[SDLC-ACCESS-CHECK-WORKER] queue unavailable');
    queue.process(2, async (job: Bull.Job<SdlcAccessCheckJobData>) => {
      await sdlcVcs.performRepositoryCheck(job.data);
    });
    queue.on('failed', (job, error) => {
      logger.error('[SDLC-ACCESS-CHECK-WORKER] job failed', {
        repoId: job.data.repoId,
        error: error.message,
      });
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    await sdlcAccessCheckQueue.close();
    this.started = false;
  }
}

export const sdlcAccessCheckWorker = new SdlcAccessCheckWorker();
