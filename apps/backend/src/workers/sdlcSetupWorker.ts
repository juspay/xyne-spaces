import type Bull from 'bull';
import { sdlcSetupQueue, type SdlcSetupJobData } from '@/queues/sdlcSetupQueue';
import { sdlcClawExecutionService } from '@/sdlc/SdlcClawExecutionService';
import { logger } from '@/utils/logger';

class SdlcSetupWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await sdlcSetupQueue.initialize();
    const queue = sdlcSetupQueue.getQueue();
    if (!queue) {
      throw new Error('[SDLC-SETUP-WORKER] queue unavailable');
    }
    queue.process(1, async (job: Bull.Job<SdlcSetupJobData>) => {
      try {
        await sdlcClawExecutionService.dispatchSetup(job.data.executionId);
      } catch (error) {
        await sdlcClawExecutionService.failDispatch(job.data.executionId, error);
        throw error;
      }
    });
    queue.on('failed', (job, error) => {
      logger.error('[SDLC-SETUP-WORKER] job failed', {
        jobId: job.id,
        executionId: job.data.executionId,
        error: error.message,
      });
    });
    this.started = true;
    logger.info('[SDLC-SETUP-WORKER] Started');
  }

  async stop(): Promise<void> {
    await sdlcSetupQueue.close();
    this.started = false;
  }
}

export const sdlcSetupWorker = new SdlcSetupWorker();
