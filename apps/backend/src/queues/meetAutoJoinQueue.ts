import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { meetAutoJoinService } from '@/services/meetAutoJoinService';

const TAG = '[MEET-AUTO-JOIN]';
const JOB_NAME = 'meet-auto-join';
const EVERY_MINUTE = '* * * * *';

/**
 * Once a minute, sends Xyne Automatic to opted-in users' Google Meet calendar events
 * that are starting (see meetAutoJoinService). Repeatable Bull job: however many
 * worker pods run, each minute's pass runs once.
 */
class MeetAutoJoinQueue {
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
        const { sent, waiting } = await meetAutoJoinService.runOnce();
        if (sent || waiting) logger.info(`${TAG} pass done`, { sent, waiting });
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

export const meetAutoJoinQueue = new MeetAutoJoinQueue();
