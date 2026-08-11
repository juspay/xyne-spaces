import type Bull from 'bull';
import { sdlcWorkQueue, type SdlcWorkJobData } from '@/queues/sdlcWorkQueue';
import { sdlcClawExecutionService } from '@/sdlc/SdlcClawExecutionService';
import { logger } from '@/utils/logger';

class SdlcWorkWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    await sdlcWorkQueue.initialize();
    const queue = sdlcWorkQueue.getQueue();
    if (!queue) throw new Error('[SDLC-WORK-WORKER] queue unavailable');
    queue.process(1, async (job: Bull.Job<SdlcWorkJobData>) => {
      try {
        await sdlcClawExecutionService.dispatchWork(job.data.executionId);
      } catch (error) {
        await sdlcClawExecutionService.failDispatch(job.data.executionId, error);
        throw error;
      }
    });
    queue.on('failed', (job, error) => {
      logger.error('[SDLC-WORK-WORKER] job failed', {
        jobId: job.id,
        executionId: job.data.executionId,
        error: error.message,
      });
    });
    this.started = true;
    logger.info('[SDLC-WORK-WORKER] Started');
  }

  async stop(): Promise<void> {
    await sdlcWorkQueue.close();
    this.started = false;
  }
}

export const sdlcWorkWorker = new SdlcWorkWorker();
