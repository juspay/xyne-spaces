import { v4 as uuidv4 } from 'uuid';
import { MessageType, ConversationParticipation } from '@xyne/shared';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ChannelPreviousValue } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export class ChannelsSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: channelId, args, previousValue } = job;

    if (!previousValue) {
      logger.warn(`[ChannelsSideEffectHandler] No previousValue for channel ${channelId}`);
      return;
    }

    const prev = previousValue as ChannelPreviousValue;

    // Check if this is a rename operation
    if (args.name === undefined || args.name === prev.name) {
      return;
    }

    const newName = args.name;
    const oldName = prev.name;

    logger.info(`[ChannelsSideEffectHandler] Processing channel rename: ${oldName} -> ${newName}`);

    try {
      // Get user info for system message
      const user = await db.user.findUnique({
        where: { id: this.ctx.userID },
        select: { name: true },
      });

      if (!user) {
        logger.warn(`[ChannelsSideEffectHandler] User not found for channel rename side effect`);
        return;
      }

      const now = Date.now();
      const nowDate = new Date(now);
      const conversationId = uuidv4();
      const messageId = uuidv4();
      const systemMessageContent = `renamed the channel from #${oldName} to #${newName}`;

      // Create conversation for the system message
      await db.conversation.create({
        data: {
          conversationId,
          channelId,
          createdBy: this.ctx.userID,
          initialMessageId: messageId,
          lastActivityAt: nowDate,
          replyCount: 0,
          pinned: false,
          metadata: undefined,
          createdAt: nowDate,
        },
      });

      // Create the system message
      await db.message.create({
        data: {
          messageId,
          conversationId,
          senderId: this.ctx.userID,
          content: systemMessageContent,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: true,
          showInChannel: false,
          createdAt: nowDate,
          metadata: {
            operationType: 'channel_renamed',
            oldName,
            newName,
            userId: this.ctx.userID,
            userName: user.name,
          },
        },
      });

      // Add creator as conversation participant
      const conversationParticipantId = uuidv4();
      await db.conversationParticipant.create({
        data: {
          id: conversationParticipantId,
          conversationId,
          userId: this.ctx.userID,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: nowDate,
        },
      });

      logger.info(`[ChannelsSideEffectHandler] Created channel rename system message for channel ${channelId}`);
    } catch (error) {
      logger.error(`[ChannelsSideEffectHandler] Failed to create channel rename system message:`, error);
      // Don't throw - let the channel rename succeed even if side effect fails
    }
  }
}
