import { PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  parseReactionsMd,
  serializeReactionsMd,
  addReactionToData,
  removeReactionFromData,
  parseRepliesMd,
  serializeRepliesMd,
  addReplyToData,
} from '@xyne/shared';

export class MessageMetadataService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Add a reaction to message's reactions_md
   * Called when a reaction is created
   */
  async addReaction(messageId: string, emojiName: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { messageId },
      select: { reactions_md: true }
    });

    const data = parseReactionsMd(message?.reactions_md);
    const updatedData = addReactionToData(data, emojiName, userId);
    const updatedMd = serializeReactionsMd(updatedData);

    await this.prisma.message.update({
      where: { messageId },
      data: { reactions_md: updatedMd }
    });

    logger.info('[MessageMetadataService] Added reaction to reactions_md', {
      messageId, emojiName, userId
    });
  }

  /**
   * Remove a reaction from message's reactions_md
   * Called when a reaction is deleted
   * Returns true if any reactions remain, false if empty
   */
  async removeReaction(messageId: string, emojiName: string, userId: string): Promise<boolean> {
    const message = await this.prisma.message.findUnique({
      where: { messageId },
      select: { reactions_md: true }
    });

    const data = parseReactionsMd(message?.reactions_md);
    const updatedData = removeReactionFromData(data, emojiName, userId);
    const updatedMd = serializeReactionsMd(updatedData);

    await this.prisma.message.update({
      where: { messageId },
      data: { reactions_md: updatedMd }
    });

    const hasReactions = Object.keys(updatedData).length > 0;

    logger.info('[MessageMetadataService] Removed reaction from reactions_md', {
      messageId, emojiName, userId, hasReactions
    });

    return hasReactions;
  }

  /**
   * Add a reply to conversation's replies_md
   * Called when a thread reply is created
   */
  async addReply(conversationId: string, replierUserId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { replies_md: true }
    });

    const data = parseRepliesMd(conversation?.replies_md);
    const updatedData = addReplyToData(data, replierUserId);
    const updatedMd = serializeRepliesMd(updatedData);

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { replies_md: updatedMd }
    });

    logger.info('[MessageMetadataService] Added reply to replies_md', {
      conversationId, replierUserId
    });
  }

  /**
   * Rebuild replies_md from remaining replies in the conversation
   * Returns latest reply metadata and whether any replies remain
   */
  async rebuildRepliesMetadata(conversationId: string): Promise<{
    hasReplies: boolean;
    latestReplyMessageId: string | null;
    latestReplierId: string | null;
  }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { initialMessageId: true }
    });

    if (!conversation?.initialMessageId) {
      return { hasReplies: false, latestReplyMessageId: null, latestReplierId: null };
    }

    const replies = await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
        messageId: { not: conversation.initialMessageId }
      },
      orderBy: { createdAt: 'asc' },
      select: { messageId: true, senderId: true }
    });

    let repliers: string[] = [];
    for (const reply of replies) {
      repliers = repliers.filter(id => id !== reply.senderId);
      repliers.push(reply.senderId);
    }

    const updatedMd = serializeRepliesMd({ repliers });

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { replies_md: updatedMd }
    });

    const latestReply = replies[replies.length - 1];
    const hasReplies = repliers.length > 0;

    logger.info('[MessageMetadataService] Rebuilt replies_md', {
      conversationId,
      hasReplies
    });

    return {
      hasReplies,
      latestReplyMessageId: latestReply?.messageId ?? null,
      latestReplierId: latestReply?.senderId ?? null
    };
  }
}

export const messageMetadataService = new MessageMetadataService(db);
