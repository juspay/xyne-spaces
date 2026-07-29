import { notificationService } from '@/services/notificationService';
import { BaseSideEffectHandler } from '../base-handler';
import type { ConversationParticipantPreviousValue, SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { NotificationType } from '@prisma/client';

/**
 * When a user's conversation_participants row is updated with a new lastReadAt,
 * send a silent data-only FCM push to their mobile sessions so the
 * notification tray for that thread can be cleared.
 */
export class ConversationParticipantsSideEffectHandler extends BaseSideEffectHandler {
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
