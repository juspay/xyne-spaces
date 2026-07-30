import Bull from 'bull';
import { logger } from '@/utils/logger';
import { recordingRepairService } from '@/services/recordingRepairService';
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
    this.queue = new Bull<RecordingRepairJobData>('recording-repair', {
      redis: redisService.getRedisConfig(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.queue.on('error', (error) => logger.error('[RECORDING-REPAIR] Queue error:', error));
    return this.queue;
  }

  async enqueue(callId: string, captureId: string): Promise<void> {
    const queue = this.ensureQueue();
    const jobId = `recording-repair:${callId}:${captureId}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (await existing.getState() !== 'failed') return;
      await existing.remove();
    }
    await queue.add('repair', { callId, captureId }, { jobId });
  }

  async recoverPending(): Promise<void> {
    for (const { callId, captureId } of await recordingRepairStateService.findPending()) {
      await this.enqueue(callId, captureId);
    }
  }

  startConsumer(): void {
    const queue = this.ensureQueue();
    queue.process('repair', (job) => recordingRepairService.process(job.data.callId, job.data.captureId));
    queue.on('failed', (job, error) => logger.error(`[RECORDING-REPAIR] Job for ${job.data?.callId}/${job.data?.captureId} failed:`, error));
    logger.info('[RECORDING-REPAIR] Consumer started');
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
  }
}

export const recordingRepairQueue = new RecordingRepairQueue();
