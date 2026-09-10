import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { activityService } from '@/services/activity/activityService';
import { radarReactionResolver } from '@/services/radar/radarReactionResolver';
import {
  reportableChannelName,
  userActivityTrackingService,
} from '@/services/userActivityTrackingService';

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

    // Usage analytics counts every reaction; the activity feed below drops
    // self-reactions. Emitted before the filter so both get what they need
    // off one set of lookups. Keyed on the reactor from the row, not the
    // mutation context, so attribution cannot drift from `isSelf`.
    userActivityTrackingService
      .trackReactionAdded(reactingUserId, {
        messageId: reaction.messageId,
        channelId: conversation.channelId,
        channelName: reportableChannelName(conversation.channel?.name, conversation.channel?.scopeType),
        ...(conversation.channel?.scopeType && { scopeType: conversation.channel.scopeType }),
        emojiName: reaction.emojiName,
        isThreadReply: isThreadActivity,
        isSelf: messageAuthorId === reactingUserId,
      })
      .catch(error => {
        logger.error('[UserActivityTracking] Failed to track reaction added activity:', {
          reactionId,
          error,
        });
      });

    if (messageAuthorId === reactingUserId) {
      return null;
    }

    return {
      reactionId,
      messageId: reaction.messageId,
      messageAuthorId,
      channelId: conversation.channelId,
      isThreadActivity,
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
      select: { senderId: true, conversationId: true },
    });

    if (!message) {
      return;
    }

    // Counterpart of REACTION_ADDED so reaction counts can go down as well as up.
    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
      select: {
        channelId: true,
        initialMessageId: true,
        channel: { select: { name: true, scopeType: true } },
      },
    });
    if (conversation?.channelId) {
      userActivityTrackingService
        .trackReactionRemoved(previousValue.userId, {
          messageId: previousValue.messageId,
          channelId: conversation.channelId,
          channelName: reportableChannelName(conversation.channel?.name, conversation.channel?.scopeType),
          ...(conversation.channel?.scopeType && { scopeType: conversation.channel.scopeType }),
          emojiName: previousValue.emojiName,
          isThreadReply: conversation.initialMessageId !== previousValue.messageId,
          isSelf: message.senderId === previousValue.userId,
        })
        .catch(error => {
          logger.error('[UserActivityTracking] Failed to track reaction removed activity:', {
            messageId: previousValue.messageId,
            error,
          });
        });
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
