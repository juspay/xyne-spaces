import { randomUUID } from 'crypto';
import { serializeInitialMessageMd, MessageType } from '@xyne/shared';

import { BaseRepository } from './base';
import { Conversation } from '@prisma/client';
import { QueryOptions } from '@/types/database';

const sourceMetadata = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const toMessageType = (value: string): MessageType =>
  (Object.values(MessageType) as string[]).includes(value) ? (value as MessageType) : MessageType.USER;

export interface CreateConversationInput {
  conversationId?: string; // Optional - for custom IDs (e.g., showInChannel child conversations)
  channelId: string;
  createdBy: string;
  initialMessageId: string;
  parentMessageId?: string;
  pinned?: boolean;
  doNotPostToChannel?: boolean;
  metadata?: Record<string, any>;
  createdAt?: Date; // Optional custom timestamp for migrations
}

export interface UpdateConversationInput {
  lastActivityAt?: Date;
  replyCount?: number;
  pinned?: boolean;
  parentMessageId?: string;
  metadata?: Record<string, any>;
  initialMessageId?: string;
  ticketId?: string;
}

export interface ConversationFilters {
  channelId?: string;
  createdBy?: string;
  pinned?: boolean;
}

export class ConversationRepository extends BaseRepository<Conversation, CreateConversationInput, UpdateConversationInput> {
  constructor() {
    super('conversation');
  }

  async create(data: CreateConversationInput): Promise<Conversation> {
    if (data.conversationId) {
      await this.validateString(data.conversationId, 'conversationId');
    }
    await this.validateString(data.channelId, 'channelId');
    await this.validateString(data.createdBy, 'createdBy');
    await this.validateString(data.initialMessageId, 'initialMessageId');

    // Stamp the denormalized tenant key from the owning channel.
    const channel = await this.db.channel.findUnique({
      where: { id: data.channelId },
      select: { workspaceId: true },
    });
    if (!channel) {
      throw new Error(`Channel not found: ${data.channelId}`);
    }

    return await this.db.conversation.create({
      data: {
        ...(data.conversationId && { conversationId: data.conversationId }),
        channelId: data.channelId,
        workspaceId: channel.workspaceId,
        createdBy: data.createdBy,
        initialMessageId: data.initialMessageId,
        parentMessageId: data.parentMessageId,
        pinned: data.pinned || false,
        ...(data.doNotPostToChannel !== undefined && {
          doNotPostToChannel: data.doNotPostToChannel,
        }),
        metadata: data.metadata,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return await this.db.conversation.findUnique({
      where: { conversationId: id }
    });
  }

  async findByIdAndWorkspace(conversationId: string, workspaceId: string): Promise<Conversation | null> {
    return await this.db.conversation.findFirst({
      where: {
        conversationId,
        channel: {
          workspaceId,
        },
      },
    });
  }

  async findMany(options?: QueryOptions): Promise<Conversation[]>;
  async findMany(filters?: ConversationFilters): Promise<Conversation[]>;
  async findMany(optionsOrFilters?: QueryOptions | ConversationFilters): Promise<Conversation[]> {
    const filters = optionsOrFilters as ConversationFilters;
    const where: any = {};

    if (filters?.channelId) {
      where.channelId = filters.channelId;
    }

    if (filters?.createdBy) {
      where.createdBy = filters.createdBy;
    }

    if (filters?.pinned !== undefined) {
      where.pinned = filters.pinned;
    }

    return await this.db.conversation.findMany({
      where,
      orderBy: [
        { pinned: 'desc' }, // Pinned conversations first
        { lastActivityAt: 'desc' } // Then by recent activity
      ]
    });
  }

  async update(id: string, data: UpdateConversationInput): Promise<Conversation> {
    return await this.db.conversation.update({
      where: { conversationId: id },
      data
    });
  }

  async updateMetadata(conversationId: string, metadata: Record<string, any>): Promise<Conversation> {
    return await this.db.conversation.update({
      where: { conversationId },
      data: { metadata },
    });
  }

  async delete(id: string): Promise<Conversation> {
    return await this.db.conversation.delete({
      where: { conversationId: id }
    });
  }

  // Conversation-specific methods
  async getChannelConversations(channelId: string): Promise<Conversation[]> {
    return await this.findMany({ channelId });
  }

  async getPinnedConversations(channelId: string): Promise<Conversation[]> {
    return await this.findMany({ channelId, pinned: true });
  }

  async incrementReplyCount(
    conversationId: string,
    replyCreatedAt?: Date | null,
    markParticipantsRead = false,
  ): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const now = new Date();
    const effectiveReplyCreatedAt = replyCreatedAt === undefined ? now : replyCreatedAt;
    const result = await this.update(conversationId, {
      replyCount: conversation.replyCount + 1,
      lastActivityAt: now,
    });

    if (effectiveReplyCreatedAt) {
      await this.db.conversationParticipant.updateMany({
        where: {
          conversationId,
          OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: effectiveReplyCreatedAt } }],
        },
        data: { lastReplyAt: effectiveReplyCreatedAt },
      });

      if (markParticipantsRead) {
        await this.db.conversationParticipant.updateMany({
          where: {
            conversationId,
            OR: [{ lastReadAt: null }, { lastReadAt: { lt: effectiveReplyCreatedAt } }],
          },
          data: { lastReadAt: effectiveReplyCreatedAt },
        });
      }
    }

    return result;
  }

  async decrementReplyCount(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const newReplyCount = Math.max(0, conversation.replyCount - 1);
    return await this.update(conversationId, {
      replyCount: newReplyCount,
    });
  }

  async updateLastActivity(conversationId: string): Promise<void> {
    await this.update(conversationId, {
      lastActivityAt: new Date(),
    });
  }

  async togglePin(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    return await this.update(conversationId, {
      pinned: !conversation.pinned,
    });
  }

  async getConversationWithInitialMessage(conversationId: string): Promise<any> {
    // This would typically join with messages table, but since we don't use FKs,
    // we'll need to manually fetch the initial message
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      return null;
    }

    // We'll need to import MessageRepository to get the initial message
    // For now, return just the conversation
    return conversation;
  }

  async searchConversationsByContent(channelId: string, _searchTerm: string): Promise<Conversation[]> {
    // This would require searching through message content
    // For now, we'll search by conversation metadata if it contains searchable fields
    return await this.db.conversation.findMany({
      where: {
        channelId,
        // Could add metadata search here if needed
      },
      orderBy: {
        lastActivityAt: 'desc'
      }
    });
  }

  /**
   * Get conversation to channel mapping for access control
   * Returns a Map of conversationId -> channelId
   */
  async getConversationChannelMapping(conversationIds: string[]): Promise<Map<string, string>> {
    const conversationChannelMap = new Map<string, string>();
    
    if (conversationIds.length === 0) return conversationChannelMap;
    
    // Use Prisma to get channel IDs for conversations
    const conversations = await this.db.conversation.findMany({
      where: {
        conversationId: {
          in: conversationIds
        }
      },
      select: {
        conversationId: true,
        channelId: true
      }
    });

    // Build the conversation -> channel mapping
    for (const conversation of conversations) {
      conversationChannelMap.set(conversation.conversationId, conversation.channelId);
    }

    return conversationChannelMap;
  }

  async copyConversationsToChannel(
    sourceChannelId: string,
    targetChannelId: string,
    workspaceId: string,
    createdAfter?: Date | null
  ): Promise<number> {
    const conversations = await this.db.conversation.findMany({
      where: {
        channelId: sourceChannelId,
        ...(createdAfter ? { createdAt: { gte: createdAfter } } : {})
      },
      orderBy: { createdAt: 'asc' }
    });

    if (conversations.length === 0) {
      return 0;
    }

    const sourceConversationIds = conversations.map(c => c.conversationId);
    const messages = await this.db.message.findMany({
      where: { conversationId: { in: sourceConversationIds }, isDeleted: false },
      orderBy: { createdAt: 'asc' }
    });

    const messagesByConversation = new Map<string, typeof messages>();
    for (const message of messages) {
      const bucket = messagesByConversation.get(message.conversationId) ?? [];
      bucket.push(message);
      messagesByConversation.set(message.conversationId, bucket);
    }

    const attachments = messages.length
      ? await this.db.messageAttachment.findMany({
          where: { entityId: { in: messages.map(m => m.messageId) }, isDeleted: false }
        })
      : [];
    const attachmentsByMessage = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      const bucket = attachmentsByMessage.get(attachment.entityId) ?? [];
      bucket.push(attachment);
      attachmentsByMessage.set(attachment.entityId, bucket);
    }

    const sourceParticipants = await this.db.conversationParticipant.findMany({
      where: { conversationId: { in: sourceConversationIds } }
    });
    const participantsByConversation = new Map<string, typeof sourceParticipants>();
    for (const participant of sourceParticipants) {
      const bucket = participantsByConversation.get(participant.conversationId) ?? [];
      bucket.push(participant);
      participantsByConversation.set(participant.conversationId, bucket);
    }

    const existingCopies = await this.db.conversation.findMany({
      where: { channelId: targetChannelId },
      select: { metadata: true }
    });
    const alreadyCopied = new Set<string>();
    for (const row of existingCopies) {
      const meta = row.metadata as { copiedFrom?: unknown } | null;
      if (typeof meta?.copiedFrom === 'string') {
        alreadyCopied.add(meta.copiedFrom);
      }
    }

    let copied = 0;

    for (const conversation of conversations) {
      if (alreadyCopied.has(conversation.conversationId)) {
        continue;
      }

      const sourceMessages = messagesByConversation.get(conversation.conversationId) ?? [];
      if (sourceMessages.length === 0) {
        continue;
      }

      const newConversationId = randomUUID();
      const copiedMessages = sourceMessages.map(message => ({
        source: message,
        newMessageId: randomUUID()
      }));

      const initial =
        copiedMessages.find(m => m.source.messageId === conversation.initialMessageId) ??
        copiedMessages[0];
      if (!initial) {
        continue;
      }
      const sourceInitialMessage = initial.source;
      const newInitialMessageId = initial.newMessageId;

      const initialMessageMd = serializeInitialMessageMd({
        messageId: newInitialMessageId,
        conversationId: newConversationId,
        workspaceId,
        senderId: sourceInitialMessage.senderId,
        content: sourceInitialMessage.content,
        msgType: toMessageType(sourceInitialMessage.msgType),
        hasAttachment: sourceInitialMessage.hasAttachment,
        edited: sourceInitialMessage.edited,
        isDeleted: false,
        showInChannel: sourceInitialMessage.showInChannel,
        visibleTo: sourceInitialMessage.visibleTo,
        createdAt: sourceInitialMessage.createdAt.getTime(),
        metadata: sourceInitialMessage.metadata
          ? JSON.stringify(sourceInitialMessage.metadata)
          : null,
        nudgeCount: null,
        isSent: true,
        reactions_md: null,
        link_preview_md: null,
        childConversationId: null
      });

      await this.db.$transaction(async tx => {
        await tx.conversation.create({
          data: {
            conversationId: newConversationId,
            channelId: targetChannelId,
            createdBy: conversation.createdBy,
            initialMessageId: newInitialMessageId,
            workspaceId,
            lastActivityAt: conversation.lastActivityAt,
            replyCount: Math.max(copiedMessages.length - 1, 0),
            createdAt: conversation.createdAt,
            threadType: conversation.threadType,
            initial_message_md: initialMessageMd,
            metadata: {
              ...sourceMetadata(conversation.metadata),
              copiedFrom: conversation.conversationId
            }
          }
        });

        await tx.message.createMany({
          data: copiedMessages.map(({ source: message, newMessageId }) => ({
            messageId: newMessageId,
            conversationId: newConversationId,
            senderId: message.senderId,
            workspaceId,
            content: message.content,
            msgType: message.msgType,
            hasAttachment: message.hasAttachment,
            edited: message.edited,
            showInChannel: message.showInChannel,
            visibleTo: message.visibleTo,
            createdAt: message.createdAt,
            metadata: message.metadata ?? undefined
          }))
        });

        const attachmentRows = copiedMessages.flatMap(({ source: message, newMessageId }) =>
          (attachmentsByMessage.get(message.messageId) ?? []).map(attachment => ({
            entityType: attachment.entityType,
            entityId: newMessageId,
            workspaceId,
            storageProvider: attachment.storageProvider,
            originalFilename: attachment.originalFilename,
            mimetype: attachment.mimetype,
            size: attachment.size,
            width: attachment.width,
            height: attachment.height,
            uploadedByUserId: attachment.uploadedByUserId,
            url: attachment.url,
            createdBy: attachment.createdBy,
            metadata: attachment.metadata ?? undefined,
            conversationId: newConversationId,
            thumbnailUrl: attachment.thumbnailUrl,
            uploadStatus: attachment.uploadStatus
          }))
        );

        if (attachmentRows.length > 0) {
          await tx.messageAttachment.createMany({ data: attachmentRows });
        }

        const participantRows = (
          participantsByConversation.get(conversation.conversationId) ?? []
        ).map(participant => ({
          conversationId: newConversationId,
          userId: participant.userId,
          channelId: targetChannelId,
          workspaceId,
          participationType: participant.participationType,
          isSubscribed: participant.isSubscribed
        }));

        if (participantRows.length > 0) {
          await tx.conversationParticipant.createMany({ data: participantRows });
        }
      });

      copied++;
    }

    return copied;
  }

  /**
   * Get ticket ID by conversation ID
   */
  async getTicketIdByConversationId(conversationId: string): Promise<string | null> {
    const conversation = await this.db.conversation.findUnique({
      where: { conversationId },
      select: { ticketId: true }
    });
    return conversation?.ticketId || null;
  }

  async findManyWithCursor(
    channelId: string,
    limit: number,
    cursor?: { conversationId: string; createdAt: number }
  ): Promise<Array<{ conversationId: string; initialMessageId: string; createdAt: Date }>> {
    const where: any = { channelId };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: new Date(cursor.createdAt),
          conversationId: { lt: cursor.conversationId }
        }
      ];
    }

    return await this.db.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        conversationId: true,
        initialMessageId: true,
        createdAt: true,
      },
    });
  }
}
