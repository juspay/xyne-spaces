import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { videoPreviewService } from '@/services/videoPreviewService';
import { logger } from '@/utils/logger';

export interface VideoPreviewJobData {
  attachmentId: string;
}

class VideoPreviewQueue {
  private queue: Bull.Queue<VideoPreviewJobData> | null = null;

  private ensureQueue(): Bull.Queue<VideoPreviewJobData> {
    if (this.queue) return this.queue;

    this.queue = new Bull<VideoPreviewJobData>('video-preview', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.queue.on('error', (error) => logger.error('[VIDEO-PREVIEW] Queue error:', error));
    return this.queue;
  }

  async enqueue(attachmentId: string): Promise<void> {
    const queue = this.ensureQueue();
    const jobId = `video-preview-${attachmentId}`;
    const existing = await queue.getJob(jobId);
    if (existing && (await existing.isFailed())) {
      await existing.remove();
    }
    await queue.add('generate-preview', { attachmentId }, { jobId });
  }

  startConsumer(): void {
    const queue = this.ensureQueue();
    queue.process('generate-preview', 1, async (job) => {
      try {
        await videoPreviewService.processAttachment(job.data.attachmentId);
      } catch (error) {
        const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
        if (job.attemptsMade + 1 >= attempts) {
          await videoPreviewService.markFailed(job.data.attachmentId, error);
        }
        throw error;
      }
    });
    queue.on('failed', (job, error) => {
      logger.error(`[VIDEO-PREVIEW] Job for ${job?.data?.attachmentId} failed:`, error);
    });
    logger.info('[VIDEO-PREVIEW] Consumer started');
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
    logger.info('[VIDEO-PREVIEW] Queue closed');
  }
}

export const videoPreviewQueue = new VideoPreviewQueue();
