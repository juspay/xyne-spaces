import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';

export class ReactionsSideEffectHandler extends BaseSideEffectHandler {
  private async getReactionContext(reactionId: string) {
    const reaction = await db.reaction.findUnique({
      where: { reactionId },
      select: { reactionId: true, messageId: true, userId: true },
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
      select: { channelId: true },
    });

    if (!conversation?.channelId) {
      return null;
    }

    const messageAuthorId = message.senderId;
    const reactingUserId = reaction.userId;

    if (messageAuthorId === reactingUserId) {
      return null;
    }

    return {
      reactionId,
      messageId: reaction.messageId,
      messageAuthorId,
      channelId: conversation.channelId,
    };
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: reactionId } = job;
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
