import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { googleMailSyncService } from '@/integrations/google-mail/syncService';

export type GoogleMailSyncJobType = 'full-sync' | 'incremental-sync' | 'scan-authenticated-sources';

export interface GoogleMailSyncJobData {
  type: GoogleMailSyncJobType;
  sourceId?: string;
}

const GOOGLE_MAIL_SYNC_CRON = process.env.GOOGLE_MAIL_SYNC_CRON || '*/10 * * * *';

class GoogleMailSyncQueue {
  private queue: Bull.Queue<GoogleMailSyncJobData> | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue<GoogleMailSyncJobData>> {
    if (this.queue) {
      return this.queue;
    }

    this.queue = new Bull<GoogleMailSyncJobData>('google-mail-sync', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  async initializeWorker(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) {
      return;
    }

    queue.process('full-sync', async job => {
      if (!job.data.sourceId) {
        throw new Error('Google Mail full-sync job is missing sourceId');
      }

      await googleMailSyncService.syncSource(job.data.sourceId, 'full');
    });

    queue.process('incremental-sync', async job => {
      if (!job.data.sourceId) {
        throw new Error('Google Mail incremental-sync job is missing sourceId');
      }

      await googleMailSyncService.syncSource(job.data.sourceId, 'incremental');
    });

    queue.process('scan-authenticated-sources', async () => {
      await googleMailSyncService.syncAuthenticatedSources();
    });

    queue.on('failed', (job, error) => {
      logger.error('[GOOGLE_MAIL] Queue job failed', {
        jobName: job.name,
        jobId: job.id,
        sourceId: job.data.sourceId,
        error: error.message,
      });
    });

    queue.on('error', error => {
      logger.error('[GOOGLE_MAIL] Queue error:', error);
    });

    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'scan-authenticated-sources') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    await queue.add(
      'scan-authenticated-sources',
      { type: 'scan-authenticated-sources' },
      {
        repeat: {
          cron: GOOGLE_MAIL_SYNC_CRON,
        },
        jobId: 'google-mail-scan-repeatable',
      }
    );

    this.workerInitialized = true;
    logger.info(`[GOOGLE_MAIL] Sync queue worker initialized (${GOOGLE_MAIL_SYNC_CRON})`);
  }

  private async enqueueJob(
    name: 'full-sync' | 'incremental-sync',
    sourceId: string
  ): Promise<void> {
    const queue = await this.ensureQueue();
    const jobId = `google-mail-${sourceId}`;
    const existingJob = await queue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        logger.info('[GOOGLE_MAIL] Sync job already queued', {
          sourceId,
          state,
          jobName: name,
        });
        return;
      }

      await existingJob.remove();
    }

    await queue.add(name, { type: name, sourceId }, { jobId });
  }

  async enqueueFullSync(sourceId: string): Promise<void> {
    await this.enqueueJob('full-sync', sourceId);
  }

  async enqueueIncrementalSync(sourceId: string): Promise<void> {
    await this.enqueueJob('incremental-sync', sourceId);
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    this.workerInitialized = false;
  }
}

export const googleMailSyncQueue = new GoogleMailSyncQueue();
