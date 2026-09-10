import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { activityService } from '@/services/activity/activityService';
import { radarReactionResolver } from '@/services/radar/radarReactionResolver';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';

export class ReactionsSideEffectHandler extends BaseSideEffectHandler {
  private async getReactionContext(reactionId: string) {
    const reaction = await db.reaction.findUnique({
      where: { reactionId },
      select: { reactionId: true, messageId: true, userId: true, emojiName: true },
    });

    if (!reaction) {
      return null;
    }

    const message = await db.message.findUnique({
      where: { messageId: reaction.messageId },
      select: { senderId: true, conversationId: true },
    });

    if (!message) {
      return null;
    }

    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
      select: {
        channelId: true,
        initialMessageId: true,
        channel: { select: { name: true, scopeType: true } },
      },
    });

    if (!conversation?.channelId) {
      return null;
    }

    const messageAuthorId = message.senderId;
    const reactingUserId = reaction.userId;
    const isThreadActivity = conversation.initialMessageId !== reaction.messageId;

    return {
      reactionId,
      messageId: reaction.messageId,
      messageAuthorId,
      channelId: conversation.channelId,
      channelName: conversation.channel?.name ?? null,
      scopeType: conversation.channel?.scopeType ?? null,
      emojiName: reaction.emojiName,
      isThreadActivity,
      isSelfReaction: messageAuthorId === reactingUserId,
    };
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: reactionId } = job;

    // Runs on its own context, not the activity one below: that path drops
    // self-reactions and never reads the emoji, and Radar needs both. Failures
    // are swallowed — execution tracking must not cost someone their
    // notification.
    try {
      await radarReactionResolver.onReaction(reactionId);
    } catch (error) {
      logger.error('[REACTIONS] Radar reaction resolve failed', { reactionId, error });
    }

    const context = await this.getReactionContext(reactionId);

    if (!context) {
      return;
    }

    // Usage analytics: every reaction in a channel counts, self-reactions
    // included; the activity feed below deliberately skips those.
    userActivityTrackingService
      .trackReactionAdded(this.ctx.userID, {
        messageId: context.messageId,
        channelId: context.channelId,
        ...(context.channelName && { channelName: context.channelName }),
        ...(context.scopeType && { scopeType: context.scopeType }),
        emojiName: context.emojiName,
        isThreadReply: context.isThreadActivity,
        isSelf: context.isSelfReaction,
      })
      .catch(error => {
        logger.error('[UserActivityTracking] Failed to track reaction added activity:', {
          reactionId,
          error,
        });
      });

    if (context.isSelfReaction) {
      return;
    }

    const isParticipant = await db.channelParticipant.findFirst({
      where: {
        channelId: context.channelId,
        userId: context.messageAuthorId,
      },
    });

    if (!isParticipant) {
      return;
    }

    await activityService.upsertReactionActivityV2({
      messageId: context.messageId,
      channelId: context.channelId,
      actorId: this.ctx.userID,
      messageAuthorId: context.messageAuthorId,
      workspaceId: this.ctx.workspaceId,
      isThreadActivity: context.isThreadActivity,
    });
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as
      | { messageId?: string; emojiName?: string; userId?: string }
      | undefined;

    if (!previousValue?.messageId || !previousValue.emojiName || !previousValue.userId) {
      return;
    }

    const message = await db.message.findUnique({
      where: { messageId: previousValue.messageId },
      select: { senderId: true },
    });

    if (!message) {
      return;
    }

    const latestNonSelfReaction = await db.reaction.findFirst({
      where: { messageId: previousValue.messageId, userId: { not: message.senderId } },
      select: { userId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestNonSelfReaction) {
      await activityService.deleteReactionActivityV2(previousValue.messageId, message.senderId);
      return;
    }

    await activityService.updateReactionActivityActorIdOnlyV2({
      messageId: previousValue.messageId,
      messageAuthorId: message.senderId,
      actorId: latestNonSelfReaction.userId,
    });
  }
}
