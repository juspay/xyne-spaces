import Bull from 'bull';
import { ActivityClassification } from '@prisma/client';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { deliverDelayedMessage } from '@/zero/utils/delayedMessageDelivery';
import { cleanupDelayedMessageAttachmentsPrisma } from '@/zero/utils/attachmentEntityCleanup';
import { activityService } from '@/services/activity/activityService';
import type { DelayedMessageJobData } from '@/queues/delayedMessageQueue';

const QUEUE_NAME = 'delayed-messages';

/** Prisma update payload for DelayedMessage – typed loosely until `prisma generate` runs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DelayedMessageUpdate = Record<string, any>;

class DelayedMessageWorker {
  private queue: Bull.Queue<DelayedMessageJobData> | null = null;
  private queuePromise: Promise<Bull.Queue<DelayedMessageJobData>> | null = null;
  private isProcessorRegistered = false;
  private isInitialized = false;

  private async getQueue(): Promise<Bull.Queue<DelayedMessageJobData>> {
    if (this.queue) return this.queue;
    if (this.queuePromise) return this.queuePromise;

    this.queuePromise = (async () => {
      const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

      const queue = new Bull<DelayedMessageJobData>(QUEUE_NAME, {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
        settings: {
          stalledInterval: 30 * 1000,
          maxStalledCount: 1,
        },
      });

      this.queue = queue;
      return queue;
    })();

    try {
      return await this.queuePromise;
    } finally {
      this.queuePromise = null;
    }
  }

  async start(): Promise<void> {
    if (this.isInitialized) return;

    const queue = await this.getQueue();

    if (!this.isProcessorRegistered) {
      // Process up to 5 jobs concurrently
      queue.process(5, async (job) => {
        return this.processJob(job);
      });
      this.isProcessorRegistered = true;
    }

    this.isInitialized = true;
    logger.info('[DelayedMessageWorker] Started');
  }

  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.queuePromise = null;
    this.isProcessorRegistered = false;
    this.isInitialized = false;
    logger.info('[DelayedMessageWorker] Shut down');
  }

  async reenqueuePendingMessages(): Promise<void> {
    const queue = await this.getQueue();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = DatabaseClient.getInstance() as any;
    const pending = await prisma.delayedMessage.findMany({
      where: { status: 'PENDING' },
    });

    const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

    let reenqueued = 0;
    let sentImmediately = 0;
    let cancelled = 0;

    for (const record of pending) {
      const scheduledFor = record.scheduledFor;
      const delayMs = scheduledFor - Date.now();

      if (delayMs >= 0) {
        // Still in the future → enqueue with calculated delay
        await queue.add(
          {
            delayedMessageId: record.id,
            channelId: record.channelId,
            conversationId: record.conversationId,
            senderId: record.senderId,
            content: record.content,
            hasAttachment: record.hasAttachment,
            scheduledFor,
          },
          { jobId: record.id, delay: delayMs }
        );
        reenqueued++;
      } else if (delayMs > -GRACE_PERIOD_MS) {
        // Between 0 and 5 minutes past → send immediately
        await queue.add(
          {
            delayedMessageId: record.id,
            channelId: record.channelId,
            conversationId: record.conversationId,
            senderId: record.senderId,
            content: record.content,
            hasAttachment: record.hasAttachment,
            scheduledFor,
          },
          { jobId: record.id, delay: 0 }
        );
        sentImmediately++;
      } else {
        // More than 5 minutes past → cancel with notification
        await cleanupDelayedMessageAttachmentsPrisma(record.id);

        const cancelUpdate: DelayedMessageUpdate = {
          status: 'CANCELLED',
          failureReason: 'Scheduled time too far in the past (server restart)',
        };
        await prisma.delayedMessage.update({
          where: { id: record.id },
          data: cancelUpdate,
        });

        try {
          await activityService.createActivity({
            userId: record.senderId,
            actorAction: 'delayed_message_cancelled',
            actionSource: 'delayed_message',
            actionSourceId: record.id,
            channelId: record.channelId,
            actorId: 'system',
            classification: ActivityClassification.FYI,
          });
        } catch (activityError) {
          logger.error(
            `[DelayedMessageWorker] Could not create cancellation activity for ${record.id}:`,
            activityError
          );
        }

        cancelled++;
      }
    }

    logger.info(
      `[DelayedMessageWorker] Re-enqueue complete: ${reenqueued} scheduled, ${sentImmediately} sent immediately, ${cancelled} cancelled`
    );
  }

  private async processJob(job: Bull.Job<DelayedMessageJobData>): Promise<void> {
    const { delayedMessageId, channelId, conversationId, senderId, content } = job.data;

    logger.info(
      `[DelayedMessageWorker] Processing job ${job.id} delayedMessageId=${delayedMessageId}`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = DatabaseClient.getInstance() as any;

    type Preflight =
      | { kind: 'missing' }
      | { kind: 'terminal'; status: string }
      | { kind: 'delivery_blocked'; failureReason: string; log: string }
      | { kind: 'ready' };

    const preflight: Preflight = await prisma.$transaction(async (ptx: any) => {
      const msg = await ptx.delayedMessage.findUnique({ where: { id: delayedMessageId } });
      if (!msg) {
        return { kind: 'missing' as const };
      }
      if (msg.status === 'SENT' || msg.status === 'FAILED' || msg.status === 'CANCELLED') {
        return { kind: 'terminal' as const, status: msg.status };
      }

      await ptx.delayedMessage.update({
        where: { id: delayedMessageId },
        data: { status: 'SENDING' },
      });

      const channel = await ptx.channel.findUnique({ where: { id: channelId } });
      if (!channel || channel.isArchived) {
        const failureReason = 'Channel deleted';
        await ptx.delayedMessage.update({
          where: { id: delayedMessageId },
          data: { status: 'FAILED', failureReason },
        });
        return {
          kind: 'delivery_blocked' as const,
          failureReason,
          log: `[DelayedMessageWorker] Channel ${channelId} not found or archived – permanent failure for delayedMessageId=${delayedMessageId}`,
        };
      }

      const participant = await ptx.channelParticipant.findUnique({
        where: { channelId_userId: { channelId, userId: senderId } },
      });
      if (!participant) {
        const failureReason = 'Sender no longer has access';
        await ptx.delayedMessage.update({
          where: { id: delayedMessageId },
          data: { status: 'FAILED', failureReason },
        });
        return {
          kind: 'delivery_blocked' as const,
          failureReason,
          log: `[DelayedMessageWorker] Sender ${senderId} is no longer a member of channel ${channelId} – permanent failure for delayedMessageId=${delayedMessageId}`,
        };
      }

      return { kind: 'ready' as const };
    });

    if (preflight.kind === 'missing') {
      logger.warn(
        `[DelayedMessageWorker] delayedMessageId=${delayedMessageId} not found, skipping`
      );
      return;
    }

    if (preflight.kind === 'terminal') {
      logger.info(
        `[DelayedMessageWorker] delayedMessageId=${delayedMessageId} already ${preflight.status}, skipping`
      );
      return;
    }

    if (preflight.kind === 'delivery_blocked') {
      logger.warn(preflight.log);
      await cleanupDelayedMessageAttachmentsPrisma(delayedMessageId);
      try {
        await activityService.createActivity({
          userId: senderId,
          actorAction: 'delayed_message_failed',
          actionSource: 'delayed_message',
          actionSourceId: delayedMessageId,
          channelId,
          actorId: 'system',
          classification: ActivityClassification.FYI,
        });
      } catch (activityError) {
        logger.error(
          `[DelayedMessageWorker] Could not create failure activity for ${delayedMessageId}:`,
          activityError
        );
      }
      return;
    }

    try {
      // Deliver the message via Zero mutators (same code path as normal message sending)
      // This ensures all side effects fire: notifications, unread counts, mentions,
      // DM reopen, bot execution, search indexing, metadata sync, etc.
      const result = await deliverDelayedMessage({
        delayedMessageId,
        channelId,
        conversationId,
        senderId,
        content,
        hasAttachment: job.data.hasAttachment,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to deliver delayed message');
      }

      logger.info(`[DelayedMessageWorker] Delivered delayedMessageId=${delayedMessageId}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      logger.error(
        `[DelayedMessageWorker] Failed to deliver delayedMessageId=${delayedMessageId}:`,
        error
      );

      // On final failure (all retries exhausted) mark as FAILED
      if (job.attemptsMade >= (job.opts.attempts ?? 1) - 1) {
        try {
          const failedUpdate: DelayedMessageUpdate = { status: 'FAILED', failureReason: reason };
          await prisma.delayedMessage.update({
            where: { id: delayedMessageId },
            data: failedUpdate,
          });
        } catch (updateError) {
          logger.error(
            `[DelayedMessageWorker] Could not update failure status for ${delayedMessageId}:`,
            updateError
          );
        }
        try {
          await cleanupDelayedMessageAttachmentsPrisma(delayedMessageId);
        } catch (cleanupError) {
          logger.error(
            `[DelayedMessageWorker] Could not clean up attachments for ${delayedMessageId}:`,
            cleanupError
          );
        }
      }

      throw error; // Re-throw so Bull retries the job
    }
  }
}

export const delayedMessageWorker = new DelayedMessageWorker();
