import Bull from 'bull';
import { logger } from '@/utils/logger';
import { callRecordingService } from '@/services/callRecordingService';

export interface RecordingStitchJobData {
  recordingId: string;
}

/**
 * Stitches a recording's HLS segments into a single MP4 after egress ends.
 *
 * Producer (the API, via `enqueue`) and consumer (the dedicated stitch worker,
 * via `startConsumer`) are split on purpose: the API only ever ADDS jobs, so the
 * CPU-heavy ffmpeg work runs exclusively in the stitch worker — never in the API
 * process. One job per recording (jobId = recordingId) so a redelivered
 * egress_ended webhook never starts a second stitch. Failures retry with backoff.
 */
class RecordingStitchQueue {
  private queue: Bull.Queue<RecordingStitchJobData> | null = null;

  /** Lazily create the queue connection (no processor). Shared by producer + consumer. */
  private ensureQueue(): Bull.Queue<RecordingStitchJobData> {
    if (this.queue) return this.queue;

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 3,
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_TLS === 'true' && {
        tls: {
          rejectUnauthorized: false,
        },
      }),
    };

    this.queue = new Bull<RecordingStitchJobData>('recording-stitch', {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.queue.on('error', (error) => {
      logger.error('[RECORDING-STITCH] Queue error:', error);
    });
    return this.queue;
  }

  /** Producer side (API): enqueue a stitch job. Never registers a processor. */
  async enqueue(recordingId: string): Promise<void> {
    const queue = this.ensureQueue();
    await queue.add('stitch', { recordingId }, { jobId: `stitch-${recordingId}` });
  }

  /** Consumer side (dedicated stitch worker only): register the ffmpeg processor. */
  startConsumer(): void {
    const queue = this.ensureQueue();
    queue.process('stitch', (job) => callRecordingService.stitchRecording(job.data.recordingId));
    queue.on('failed', (job, error) => {
      logger.error(`[RECORDING-STITCH] Job for ${job.data?.recordingId} failed:`, error);
    });
    logger.info('[RECORDING-STITCH] Consumer started');
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      logger.info('[RECORDING-STITCH] Queue closed');
    }
  }
}

export const recordingStitchQueue = new RecordingStitchQueue();
