import { PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { unwrapForColumn } from '@/database/unwrapUnreadable';
import { compose } from '@/services/encryption/compose';
import { seal, storedInputs } from '@/services/encryption/mdCompose';
import { logger } from '@/utils/logger';
import {
  parseReactionsMd,
  serializeReactionsMd,
  addReactionToData,
  removeReactionFromData,
  serializeRepliesMd,
  initialMessageMdTemplate,
  parentMessageMdTemplate,
  repliesMdAddReplierTemplate,
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

  /** The conversation's replies_md with `replierUserId` added, built by compose; undefined when unchanged. */
  async composeRepliesMdAfterReply(conversationId: string, replierUserId: string): Promise<string | undefined> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { replies_md: true, workspaceId: true },
    });
    if (!conversation) return undefined;
    const result = await compose(
      {
        template: repliesMdAddReplierTemplate,
        inputs: storedInputs(repliesMdAddReplierTemplate, { repliesMd: conversation.replies_md, replierId: replierUserId }),
        current: seal(conversation.replies_md),
      },
      { workspaceId: conversation.workspaceId },
    );
    return result.unchanged ? undefined : unwrapForColumn('conversations', 'replies_md', result.value);
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
  /** `initial_message_md` for a conversation not stored yet, built by compose from its first message (createdAt in ms). */
  async composeNewInitialMessageMd(message: object, workspaceId: string): Promise<string> {
    const result = await compose(
      { template: initialMessageMdTemplate, inputs: storedInputs(initialMessageMdTemplate, message) },
      { workspaceId },
    );
    if (result.unchanged) throw new Error('compose initialMessageMd: unchanged without a current value');
    return unwrapForColumn('conversations', 'initial_message_md', result.value);
  }

  /** `parent_message_md` for a conversation not stored yet, hanging off `parentMessageId`; undefined without it. */
  async composeNewParentMessageMd(parentMessageId: string, workspaceId: string): Promise<string | undefined> {
    const parent = await this.prisma.message.findUnique({
      where: { messageId: parentMessageId },
      select: { messageId: true, conversationId: true, senderId: true, content: true, msgType: true, createdAt: true },
    });
    if (!parent) return undefined;
    const result = await compose(
      { template: parentMessageMdTemplate, inputs: storedInputs(parentMessageMdTemplate, { ...parent, createdAt: parent.createdAt.getTime() }) },
      { workspaceId },
    );
    if (result.unchanged) throw new Error('compose parentMessageMd: unchanged without a current value');
    return unwrapForColumn('conversations', 'parent_message_md', result.value);
  }

  /**
   * Sync initial_message_md on a conversation from the initial message
   */
  async syncInitialMessageMd(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { initialMessageId: true, initial_message_md: true, workspaceId: true },
    });

    if (!conversation?.initialMessageId) return;

    const message = await this.prisma.message.findUnique({
      where: { messageId: conversation.initialMessageId },
    });

    if (!message) return;

    // The message text is unreadable: the encryption service builds the md (initialMessageMd).
    const result = await compose(
      {
        template: initialMessageMdTemplate,
        inputs: storedInputs(initialMessageMdTemplate, { ...message, createdAt: message.createdAt.getTime() }),
        current: seal(conversation.initial_message_md),
      },
      { workspaceId: conversation.workspaceId },
    );
    if (result.unchanged) return;

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { initial_message_md: unwrapForColumn('conversations', 'initial_message_md', result.value) },
    });

    logger.info('[MessageMetadataService] Synced initial_message_md', { conversationId });
  }

  /**
   * Sync parent_message_md on a conversation from the parent message
   */
  async syncParentMessageMd(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: { parentMessageId: true, parent_message_md: true, workspaceId: true },
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

    const result = await compose(
      {
        template: parentMessageMdTemplate,
        inputs: storedInputs(parentMessageMdTemplate, { ...message, createdAt: message.createdAt.getTime() }),
        current: seal(conversation.parent_message_md),
      },
      { workspaceId: conversation.workspaceId },
    );
    if (result.unchanged) return;

    await this.prisma.conversation.update({
      where: { conversationId },
      data: { parent_message_md: unwrapForColumn('conversations', 'parent_message_md', result.value) },
    });

    logger.info('[MessageMetadataService] Synced parent_message_md', { conversationId });
  }
}

export const messageMetadataService = new MessageMetadataService(db);
