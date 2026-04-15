import Bull from 'bull';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { conversationService } from '@/services/conversationService';
import { MessageType, AuthProvider, UserStatus, UserType } from '@prisma/client';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import {
  scheduledMessageQueue,
  type ScheduledMessageJobData,
} from '@/queues/scheduledMessageQueue';

class ScheduledMessageWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await scheduledMessageQueue.initialize();

    const queue = scheduledMessageQueue.getQueue();

    queue.process('send-scheduled-message', async (job: Bull.Job<ScheduledMessageJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[SCHEDULED-MESSAGE-WORKER] Job ${job.id} failed — message ${job.data.messageId}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[SCHEDULED-MESSAGE-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<ScheduledMessageJobData>): Promise<void> {
    const { messageId, channelId } = job.data;
    logger.info(
      `[SCHEDULED-MESSAGE-WORKER] Processing job ${job.id} — message ${messageId} in channel ${channelId}`,
    );

    // Guard: re-read isActive in case the message was deactivated/deleted
    // after the job was scheduled (handles soft-disable race condition)
    const scheduledMessage = await db.scheduledMessage.findUnique({
      where: { id: messageId },
    });
    if (!scheduledMessage || !scheduledMessage.isActive) {
      logger.info(
        `[SCHEDULED-MESSAGE-WORKER] Message ${messageId} inactive or not found — skipping`,
      );
      return;
    }

    logger.info(
      `[SCHEDULED-MESSAGE-WORKER] Message found: ${scheduledMessage.title}`,
    );

    // Get or create the scheduler bot user
    const botEmail = 'scheduler-bot@bot.xyne.ai';
    let botUser = await db.user.findUnique({ where: { email: botEmail } });

    if (!botUser) {
      logger.info(`[SCHEDULED-MESSAGE-WORKER] Creating scheduler bot user: ${botEmail}`);
      botUser = await db.user.create({
        data: {
          name: 'Scheduler Bot',
          email: botEmail,
          authProvider: AuthProvider.API_KEY,
          providerUserId: 'bot_scheduler-bot',
          status: UserStatus.ACTIVE,
          userType: UserType.BOT,
          metadata: {
            botId: 'scheduler-bot',
            description: 'Posts scheduled messages to channels',
          },
        },
      });
    }

    // Format the message with HTML (title + content)
    // messageContent already contains rich text HTML from InputBox
    const formattedMessage = `<p><strong>📅 ${scheduledMessage.title}</strong></p>${scheduledMessage.messageContent}`;

    // Create a new conversation with the scheduled message
    const result = await conversationService.createConversationWithMessage({
      channelId,
      userId: botUser.id,
      content: formattedMessage,
      msgType: MessageType.BOT,
      isBot: true,
    });

    try {
      const handler = new MessagesSideEffectHandler({ userID: botUser.id });
      await handler.onInsert({
        entityId: result.message.messageId,
        entityType: 'messages',
        operation: 'insert',
      });
    } catch (err) {
      logger.error('[SCHEDULED-MESSAGE-WORKER] Side-effect handler error (non-fatal):', err);
    }

    logger.info(
      `[SCHEDULED-MESSAGE-WORKER] Successfully posted message ${messageId} to channel ${channelId}, conversationId: ${result.conversation.conversationId}`,
    );
  }

  async shutdown(): Promise<void> {
    await scheduledMessageQueue.close();
    this.isInitialized = false;
    logger.info('[SCHEDULED-MESSAGE-WORKER] Shut down');
  }
}

export const scheduledMessageWorker = new ScheduledMessageWorker();
