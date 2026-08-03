import { notificationService } from '@/services/notificationService';
import { getOrGenerateThreadSummary, isThreadSummaryEnabledForChannel, flagThreadRecommendation } from '@/services/threadSummaryService';
import { db } from '@/database/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { ConversationParticipantPreviousValue, SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { NotificationType } from '@prisma/client';

// How long the onInsert side effect keeps retrying/awaiting the participant row
// to settle before giving up (the thread-recommendation flag write races the
// participant insert). Matches the original twin-recap handler.
const ON_INSERT_TIMEOUT_MS = 45_000;

/**
 * When a user's conversation_participants row is updated with a new lastReadAt,
 * send a silent data-only FCM push to their mobile sessions so the
 * notification tray for that thread can be cleared.
 */
export class ConversationParticipantsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ConversationParticipantsHandler] onInsert entity=${job.entityId} actor=${this.ctx.userID}`);
    // The timeout side of Promise.race is never implicitly cancelled when
    // processInsert wins (the common case) — without clearing it explicitly,
    // its setTimeout keeps firing (harmlessly, since the race already
    // settled) up to ON_INSERT_TIMEOUT_MS after every single participant
    // insert, accumulating dangling timers under load.
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
      // Self-joined (e.g. by replying) — no need to catch them up.
      logger.info(`[ConversationParticipantsHandler] Skipping self-join: user ${userId} in conversation ${conversationId}`);
      return;
    }

    if (!isThreadSummaryEnabledForChannel(channelId)) {
      return;
    }

    // This is the one moment we know with certainty — not inferred later
    // from lastReadAt/joinedAt timestamps (which broke down in practice,
    // see threadSummaryService) — that `userId` was genuinely just
    // added by someone else. Flag it once for the frontend to consume.
    await flagThreadRecommendation(conversationId, userId);

    // Pre-warm the in-memory thread-summary cache (see threadSummaryService)
    // so it's ready immediately instead of the newly-added participant
    // having to click-and-wait. The cache is shared across users to dedupe
    // LLM calls; anyone can also trigger/refresh it on demand via the
    // thread panel button.
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
