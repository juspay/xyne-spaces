import Bull from 'bull';
import { logger } from '@/utils/logger';
import {
  RecordingRepairTerminalError,
  recordingRepairService,
} from '@/services/recordingRepairService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import { redisService } from '@/services/redisService';

interface RecordingRepairJobData {
  callId: string;
  captureId: string;
}

class RecordingRepairQueue {
  private queue: Bull.Queue<RecordingRepairJobData> | null = null;

  private ensureQueue(): Bull.Queue<RecordingRepairJobData> {
    if (this.queue) return this.queue;
    const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };
    this.queue = new Bull<RecordingRepairJobData>('recording-repair', {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.queue.on('error', (error) => logger.error('[RECORDING-REPAIR] Queue error:', error));
    return this.queue;
  }

  async enqueue(
    callId: string,
    captureId: string,
    finalizedAt: number | null = null
  ): Promise<void> {
    const queue = this.ensureQueue();
    const jobId = `recording-repair:${callId}:${captureId}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      if ((await existing.getState()) !== 'failed') return;
      await existing.remove();
    }
    const delay = Math.max(0, (finalizedAt ?? Date.now()) + 45_000 - Date.now());
    await queue.add('repair', { callId, captureId }, { jobId, delay });
  }

  async recoverPending(): Promise<void> {
    const pending = await recordingRepairStateService.findPending();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(10, pending.length) }, async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        if (!item) continue;
        const state = await recordingRepairStateService.get(item.callId, item.captureId);
        await this.enqueue(item.callId, item.captureId, state?.finalizedAt ?? null);
      }
    });
    await Promise.all(workers);
  }

  startConsumer(): void {
    const queue = this.ensureQueue();
    queue.process('repair', async (job) => {
      try {
        await recordingRepairService.process(job.data.callId, job.data.captureId);
      } catch (error) {
        // A headerless MediaRecorder fragment cannot become valid on retry.
        if (error instanceof RecordingRepairTerminalError) job.discard();
        throw error;
      }
    });
    queue.on('failed', (job, error) => {
      logger.error(
        `[RECORDING-REPAIR] Job for ${job.data?.callId}/${job.data?.captureId} failed:`,
        error
      );
      // Claimed jobs persist their own fenced failure state. Deferred jobs are
      // deliberately left FINALIZED so the recovery sweep can enqueue them once
      // the live transcript commit signal exists.
    });
    logger.info('[RECORDING-REPAIR] Consumer started');
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
  }
}

export const recordingRepairQueue = new RecordingRepairQueue();
