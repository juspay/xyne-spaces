import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { meetTranscriptService } from '@/services/meetTranscriptService';

const TAG = '[MEET-TRANSCRIPT]';
const JOB_NAME = 'meet-transcript';
const EVERY_MINUTE = '* * * * *';

/**
 * Once a minute: turns Google Meet's transcription on for opted-in organisers'
 * upcoming meetings and saves the transcripts of the ones that ended (see
 * meetTranscriptService). Repeatable Bull job: however many worker pods run, each
 * minute's pass runs once.
 */
class MeetTranscriptQueue {
  private queue: Bull.Queue<Record<string, never>> | null = null;

  async initialize(): Promise<void> {
    if (this.queue) return;
    try {
      this.queue = new Bull<Record<string, never>>(JOB_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        // A failed pass is not retried: the next minute's pass covers it.
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
      });

      this.queue.process(JOB_NAME, async () => {
        const { enabled, saved } = await meetTranscriptService.runOnce();
        if (enabled || saved) logger.info(`${TAG} pass done`, { enabled, saved });
      });
      this.queue.on('failed', (job, error) => logger.error(`${TAG} pass ${job.id} failed:`, error));
      this.queue.on('error', (error) => logger.error(`${TAG} queue error:`, error));

      // Replace any earlier schedule so a changed cron takes effect.
      for (const job of await this.queue.getRepeatableJobs()) {
        await this.queue.removeRepeatableByKey(job.key);
      }
      await this.queue.add(JOB_NAME, {}, { repeat: { cron: EVERY_MINUTE }, jobId: `${JOB_NAME}-repeatable` });
      logger.info(`${TAG} queue initialized (every minute)`);
    } catch (error) {
      logger.error(`${TAG} failed to initialize queue:`, error);
      this.queue = null;
    }
  }

  async close(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
  }
}

export const meetTranscriptQueue = new MeetTranscriptQueue();
