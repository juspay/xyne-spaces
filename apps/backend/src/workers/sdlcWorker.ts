import type Bull from 'bull';
import { config } from '@/config/env';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import { sdlcQueue, type SdlcJobData } from '@/queues/sdlcQueue';
import { sdlcClawExecutionService } from '@/sdlc/SdlcClawExecutionService';
import { sdlcWikiExecutionService } from '@/sdlc/wiki/SdlcWikiExecutionService';
import { logger } from '@/utils/logger';

class SdlcCapacityError extends Error {
  constructor(repoId: string) {
    super(`SDLC capacity unavailable for repository ${repoId}`);
    this.name = 'SdlcCapacityError';
  }
}

class SdlcCapacityTimeoutError extends Error {
  constructor(repoId: string) {
    super(`SDLC capacity wait limit exceeded for repository ${repoId}`);
    this.name = 'SdlcCapacityTimeoutError';
  }
}

class SdlcWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    await sdlcQueue.initialize();
    await Promise.all([
      sdlcClawExecutionService.restoreAdmissionPermits(),
      sdlcWikiExecutionService.restoreAdmissionPermits(),
    ]);
    const queue = sdlcQueue.getQueue();
    if (!queue) throw new Error('[SDLC-WORKER] queue unavailable');
    queue.process(config.sdlcGlobalActiveLimit, (job) => this.process(job));
    queue.on('failed', (job, error) => {
      if (error.name === 'SdlcCapacityError') return;
      logger.error('[SDLC-WORKER] job failed', {
        jobId: job.id,
        type: job.data.type,
        repoId: job.data.repoId,
        error: error.message,
      });
    });
    this.started = true;
    logger.info('[SDLC-WORKER] Started', {
      globalActiveLimit: config.sdlcGlobalActiveLimit,
      repoActiveLimit: config.sdlcRepoActiveLimit,
    });
  }

  private async process(job: Bull.Job<SdlcJobData>): Promise<unknown> {
    // Redis is not typed: an access-check job left from before they moved inline would
    // otherwise fall through to the WIKI branch with an undefined executionId.
    if (!['SETUP', 'WORK', 'WIKI'].includes(job.data.type)) {
      logger.warn('[SDLC-WORKER] discarding unsupported job', {
        jobId: job.id,
        type: job.data.type,
      });
      job.discard();
      await sdlcAdmission.unregisterPending(job.data.repoId, String(job.id));
      return { discarded: true };
    }

    const permit = await sdlcAdmission.tryAcquire({
      repoId: job.data.repoId,
      jobId: String(job.id),
      globalLimit: config.sdlcGlobalActiveLimit,
      repoLimit: config.sdlcRepoActiveLimit,
    });
    if (!permit) {
      const capacityBlockedAt = job.data.capacityBlockedAt ?? job.timestamp;
      if (job.data.capacityBlockedAt === undefined) {
        await job.update({ ...job.data, capacityBlockedAt });
      }
      const attemptLimit = job.opts.attempts ?? 1;
      const capacityExpired =
        Date.now() - capacityBlockedAt >= config.sdlcCapacityWaitTimeoutMs ||
        job.attemptsMade + 1 >= attemptLimit;
      if (!capacityExpired) throw new SdlcCapacityError(job.data.repoId);

      const error = new SdlcCapacityTimeoutError(job.data.repoId);
      job.discard();
      await sdlcAdmission.unregisterPending(job.data.repoId, String(job.id));
      if (job.data.type === 'WIKI') {
        await sdlcWikiExecutionService.failDispatch(job.data.executionId, error);
      } else {
        await sdlcClawExecutionService.failDispatch(job.data.executionId, error);
      }
      throw error;
    }

    try {
      const dispatched =
        job.data.type === 'SETUP'
          ? await sdlcClawExecutionService.dispatchSetup(job.data.executionId, permit.permitId)
          : job.data.type === 'WORK'
            ? await sdlcClawExecutionService.dispatchWork(job.data.executionId, permit.permitId)
            : await sdlcWikiExecutionService.dispatch(job.data.executionId, permit.permitId);
      if (!dispatched) await sdlcAdmission.release(permit.permitId);
      return { dispatched };
    } catch (error) {
      await sdlcAdmission.release(permit.permitId);
      job.discard();
      if (job.data.type === 'WIKI') {
        await sdlcWikiExecutionService.failDispatch(job.data.executionId, error);
      } else {
        await sdlcClawExecutionService.failDispatch(job.data.executionId, error);
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    await sdlcQueue.close();
    this.started = false;
  }
}

export const sdlcWorker = new SdlcWorker();
