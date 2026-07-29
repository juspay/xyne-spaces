import { scheduledMessageQueue } from '@/queues/scheduledMessageQueue';
import { logger } from '@/utils/logger';

const JOB_NAME = 'send-scheduled-message';

class ScheduledMessageService {
  // ── Bull helpers ──────────────────────────────────────────────────────────
  // getQueue() is sync (throws if not initialized) — queue must be initialized
  // at startup before the service is used.

  async syncJob(channelId: string, cron: string, messageId: string): Promise<void> {
    const queue = scheduledMessageQueue.getQueue();

    // Remove existing repeatable job for this message (matched by messageId)
    const jobs = await queue.getRepeatableJobs();
    const old = jobs.find(j => j.id === messageId);

    if (old) {
      await queue.removeRepeatableByKey(old.key);
      logger.info(`[SCHEDULED-MESSAGE-SERVICE] Updated job for message ${messageId}`);
    } else {
      logger.info(`[SCHEDULED-MESSAGE-SERVICE] Created job for message ${messageId}`);
    }

    // Add new repeatable job - use messageId as jobId (each scheduled message is unique)
    // IMPORTANT: tz: 'UTC' is required because Bull uses server local timezone by default
    // Since we store cron in UTC, we must tell Bull to interpret it as UTC
    await queue.add(
      JOB_NAME,
      { messageId, channelId },
      {
        repeat: { cron, tz: 'UTC' },
        jobId: messageId, // Use messageId so multiple scheduled messages per channel work
      },
    );
  }

  async removeJob(messageId: string): Promise<void> {
    const queue = scheduledMessageQueue.getQueue();

    const jobs = await queue.getRepeatableJobs();

    // Find the job by messageId
    const matchingJob = jobs.find(j => j.id === messageId);

    if (matchingJob) {
      await queue.removeRepeatableByKey(matchingJob.key);
      logger.info(`[SCHEDULED-MESSAGE-SERVICE] Removed job for message ${messageId}`);
    } else {
      logger.warn(`[SCHEDULED-MESSAGE-SERVICE] No job found for message ${messageId}`);
    }
  }
}

export const scheduledMessageService = new ScheduledMessageService();
