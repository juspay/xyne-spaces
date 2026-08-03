import { notificationService } from '@/services/notificationService';
import { getOrGenerateThreadSummary, isThreadSummaryEnabledForChannel, flagThreadRecommendation } from '@/services/threadSummaryService';
import { db } from '@/database/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { ConversationParticipantPreviousValue, SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { NotificationType } from '@prisma/client';

const ON_INSERT_TIMEOUT_MS = 45_000;

/**
 * When a user's conversation_participants row is updated with a new lastReadAt,
 * send a silent data-only FCM push to their mobile sessions so the
 * notification tray for that thread can be cleared.
 */
export class ConversationParticipantsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ConversationParticipantsHandler] onInsert entity=${job.entityId} actor=${this.ctx.userID}`);
    let timeoutHandle: NodeJS.Timeout;
    try {
      await Promise.race([
        this.processInsert(job),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`onInsert timed out after ${ON_INSERT_TIMEOUT_MS}ms`)),
            ON_INSERT_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));
    } catch (error) {
      logger.error(`[ConversationParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }

  private async processInsert(job: SideEffectJobConfig): Promise<void> {
    const participant = await db.conversationParticipant.findUnique({
      where: { id: job.entityId },
      select: { conversationId: true, userId: true, channelId: true },
    });

    if (!participant) {
      logger.warn(`[ConversationParticipantsHandler] No conversationParticipant row found for entity ${job.entityId}`);
      return;
    }

    const { conversationId, userId, channelId } = participant;

    if (this.ctx.userID === userId) {
      logger.info(`[ConversationParticipantsHandler] Skipping self-join: user ${userId} in conversation ${conversationId}`);
      return;
    }

    if (!isThreadSummaryEnabledForChannel(channelId)) {
      return;
    }

    await flagThreadRecommendation(conversationId, userId);

    await getOrGenerateThreadSummary(conversationId);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as ConversationParticipantPreviousValue | undefined;
    const args = job.args as { lastReadAt?: number } | undefined;

    if (!prev) {
      return;
    }

    // Only react to lastReadAt changes
    if (args?.lastReadAt == null) {
      return;
    }

    // If no unseen content existed before this update, skip
    const hadUnseenContent =
      prev.lastReplyAt != null &&
      (prev.lastReadAt == null || prev.lastReadAt < prev.lastReplyAt);
    if (!hadUnseenContent) return;


    try {
      await notificationService.createNotification(prev.userId, {
        title: 'Silent notification', 
        message: 'silent notification',
        type: NotificationType.THREAD_READ,
        metadata: {
          conversationId: prev.conversationId,
        }
      }, { sendDesktop: true, sendMobile: true, isSilent: true})
      logger.info(
        `[SideEffect] Sent THREAD_READ FCM for user ${prev.userId}, conversation ${prev.conversationId}`
      );
    } catch (error) {
      logger.error(`[SideEffect] Failed to send THREAD_READ FCM:`, error);
    }
  }
}
