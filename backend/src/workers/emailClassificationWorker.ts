import Bull from 'bull';
import { logger } from '@/utils/logger';
import { emailClassificationQueue, type EmailClassificationJobData } from '@/queues/emailClassificationQueue';
import { EmailClassificationService } from '@/services/emailClassificationService';
import { DatabaseClient } from '@/database/client';

const emailClassificationService = new EmailClassificationService();
const prisma = DatabaseClient.getInstance();

class EmailClassificationWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await emailClassificationQueue.initialize();

    const queue = emailClassificationQueue.getQueue();

    queue.process('classify', 5, async (job: Bull.Job<EmailClassificationJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[EMAIL-CLASSIFICATION-WORKER] Job ${job.id} permanently failed — ticket ${job.data.ticketId}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[EMAIL-CLASSIFICATION-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<EmailClassificationJobData>): Promise<void> {
    const { ticketId, channelId, subject, body, groupId } = job.data;
    logger.info(`[EMAIL-CLASSIFICATION-WORKER] Processing job ${job.id} — ticket ${ticketId}`);

    const classificationData = await emailClassificationService.classify(channelId, subject, body);
    if (!classificationData) return;

    const { result, config } = classificationData;
    const resolvedGroupId = await emailClassificationService.resolveUserGroup(result, config);
    const effectiveGroupId = resolvedGroupId ?? groupId ?? null;

    await emailClassificationService.storeOnTicket(ticketId, result, effectiveGroupId);

    const priorityAboveThreshold =
      result.priority &&
      result.priority.confidence >= (config.priorityClassificationThreshold ?? 0.5);

    if (effectiveGroupId || priorityAboveThreshold) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          ...(effectiveGroupId && { userGroupId: effectiveGroupId }),
          ...(priorityAboveThreshold && {
            priority: result.priority!.priority,
            aiPriority: result.priority!.priority,
          }),
        },
      });

      if (effectiveGroupId) {
        logger.info(
          resolvedGroupId
            ? `[EMAIL-CLASSIFICATION-WORKER] Auto-assigned ticket ${ticketId} to group ${effectiveGroupId}`
            : `[EMAIL-CLASSIFICATION-WORKER] Fell back to default group ${effectiveGroupId} for ticket ${ticketId}`,
        );
      }
      if (priorityAboveThreshold) {
        logger.info(
          `[EMAIL-CLASSIFICATION-WORKER] Auto-set priority to ${result.priority!.priority} for ticket ${ticketId}`,
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    await emailClassificationQueue.close();
    this.isInitialized = false;
    logger.info('[EMAIL-CLASSIFICATION-WORKER] Shut down');
  }
}

export const emailClassificationWorker = new EmailClassificationWorker();
