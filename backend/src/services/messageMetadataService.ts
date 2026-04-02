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
  serializeInitialMessageMd,
  serializeParentMessageMd,
} from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';

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
  /**
   * Sync initial_message_md on a conversation from the initial message
   */
  async syncInitialMessageMd(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { initialMessageId: true, initial_message_md: true },
    });

    if (!conversation?.initialMessageId) return;

    const message = await this.prisma.message.findUnique({
      where: { messageId: conversation.initialMessageId },
    });

    if (!message) return;

    const summary: InitialMessageSummary = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      msgType: message.msgType as InitialMessageSummary['msgType'],
      hasAttachment: message.hasAttachment,
      edited: message.edited,
      isDeleted: message.isDeleted,
      showInChannel: message.showInChannel,
      visibleTo: message.visibleTo,
      createdAt: message.createdAt.getTime(),
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      nudgeCount: message.nudgeCount,
      isSent: message.isSent,
      reactions_md: message.reactions_md,
      link_preview_md: message.link_preview_md,
      childConversationId: message.childConversationId,
    };

    const md = serializeInitialMessageMd(summary);
    if (conversation.initial_message_md === md) return;

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { initial_message_md: md },
    });

    logger.info('[MessageMetadataService] Synced initial_message_md', { conversationId });
  }

  /**
   * Sync parent_message_md on a conversation from the parent message
   */
  async syncParentMessageMd(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { parentMessageId: true, parent_message_md: true },
    });

    if (!conversation?.parentMessageId) return;

    const message = await this.prisma.message.findUnique({
      where: { messageId: conversation.parentMessageId },
      select: {
        messageId: true,
        conversationId: true,
        senderId: true,
        content: true,
        msgType: true,
        createdAt: true,
      },
    });

    if (!message) return;

    const summary: ParentMessageSummary = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      msgType: message.msgType as ParentMessageSummary['msgType'],
      createdAt: message.createdAt.getTime(),
    };

    const md = serializeParentMessageMd(summary);
    if (conversation.parent_message_md === md) return;

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { parent_message_md: md },
    });

    logger.info('[MessageMetadataService] Synced parent_message_md', { conversationId });
  }
}

export const messageMetadataService = new MessageMetadataService(db);
