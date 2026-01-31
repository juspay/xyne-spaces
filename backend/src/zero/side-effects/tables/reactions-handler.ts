import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';

export class ReactionsSideEffectHandler extends BaseSideEffectHandler {

  private async getReactionContext(reactionId: string) {
    const reaction = await db.reaction.findUnique({
      where: { reactionId },
    });

    if (!reaction) {
      return null;
    }

    const message = await db.message.findUnique({
      where: { messageId: reaction.messageId },
      select: {
        senderId: true,
        conversationId: true,
      },
    });

    if (!message) {
      return null;
    }

    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
      select: {
        channelId: true,
      },
    });

    if (!conversation?.channelId) {
      return null;
    }

    const messageAuthorId = message.senderId;
    const reactingUserId = reaction.userId;

    // Don't create activity for self-reactions
    if (messageAuthorId === reactingUserId) {
      return null;
    }

    return {
      reactionId,
      messageId: reaction.messageId, // Include messageId for new FK column
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

    await activityService.createActivity({
      userId: context.messageAuthorId,
      actorAction: 'added',
      // Dual-write: populate both old and new columns
      actionSource: 'reaction',
      actionSourceId: context.reactionId,
      reactionId: context.reactionId,
      messageId: context.messageId, // Also store messageId for easier querying
      channelId: context.channelId,
    });
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { entityId: reactionId } = job;
  
    await activityService.deleteActivitiesBySource('reaction', reactionId);
  }
}
