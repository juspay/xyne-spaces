import { BaseRepository } from './base';
import { Conversation } from '@prisma/client';
import { QueryOptions } from '@/types/database';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

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

  async getHistoryPreview(
    channelId: string,
    createdAfter: Date | null,
    limit: number
  ): Promise<
    Array<{
      conversationId: string;
      createdAt: Date;
      initialMessage: { senderId: string; content: string } | null;
      attachments: Array<{ id: string; originalFilename: string }>;
    }>
  > {
    const conversations = await this.db.conversation.findMany({
      where: {
        channelId,
        ...(createdAfter ? { createdAt: { gte: createdAfter } } : {}),
        OR: [{ doNotPostToChannel: null }, { doNotPostToChannel: false }]
      },
      orderBy: { createdAt: 'asc' },
      take: limit
    });

    if (conversations.length === 0) {
      return [];
    }

    const initialMessages = await this.db.message.findMany({
      where: {
        messageId: { in: conversations.map(c => c.initialMessageId) },
        isDeleted: false
      },
      select: { messageId: true, senderId: true, content: true }
    });
    const byId = new Map(initialMessages.map(m => [m.messageId, m]));

    const attachments = await this.db.messageAttachment.findMany({
      where: {
        entityId: { in: conversations.map(c => c.initialMessageId) },
        isDeleted: false
      },
      select: { id: true, entityId: true, originalFilename: true }
    });
    const attachmentsByMessage = new Map<string, Array<{ id: string; originalFilename: string }>>();
    for (const attachment of attachments) {
      const bucket = attachmentsByMessage.get(attachment.entityId) ?? [];
      bucket.push({ id: attachment.id, originalFilename: attachment.originalFilename });
      attachmentsByMessage.set(attachment.entityId, bucket);
    }

    return conversations.map(conversation => {
      const initial = byId.get(conversation.initialMessageId);
      return {
        conversationId: conversation.conversationId,
        createdAt: conversation.createdAt,
        initialMessage: initial
          ? { senderId: initial.senderId, content: initial.content }
          : null,
        attachments: attachmentsByMessage.get(conversation.initialMessageId) ?? []
      };
    });
  }

  /**
   * Reparent a channel's conversations into another channel. Messages and attachments hang off
   * `conversationId` so they follow automatically; `conversationParticipant.channelId` is
   * denormalized and has to be moved explicitly. Threads move whole, keyed on when the thread
   * started — one opened before the cutoff stays put even if it has replies after it.
   */
  async moveConversationsToChannel(
    sourceChannelId: string,
    targetChannelId: string,
    createdAfter?: Date | null
  ): Promise<{ moved: number; remaining: number }> {
    const conversations = await this.db.conversation.findMany({
      where: {
        channelId: sourceChannelId,
        ...(createdAfter ? { createdAt: { gte: createdAfter } } : {})
      },
      select: { conversationId: true }
    });

    if (conversations.length === 0) {
      return {
        moved: 0,
        remaining: await this.db.conversation.count({ where: { channelId: sourceChannelId } })
      };
    }

    const conversationIds = conversations.map(c => c.conversationId);

    const [movedConversations] = await this.db.$transaction([
      this.db.conversation.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.conversationParticipant.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.conversationLabelMapping.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.draftMessage.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.surfaceNudgeCount.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.releaseEvent.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
    
      this.db.activity.updateMany({
        where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
        data: { channelId: targetChannelId }
      }),
      this.db.messageArtifact.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.executionItem.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.delayedMessage.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.prThreadLink.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.email.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      this.db.emailDraft.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { channelId: targetChannelId }
      }),
      // these point at a conversation that just left the channel
      this.db.channelParticipant.updateMany({
        where: { channelId: sourceChannelId, lastViewedConversationId: { in: conversationIds } },
        data: { lastViewedConversationId: null }
      }),
      this.db.channelUserStatus.updateMany({
        where: { channelId: sourceChannelId, lastViewedConversationId: { in: conversationIds } },
        data: { lastViewedConversationId: null }
      })
    ]);

    await this.reindexMovedMessages(conversationIds);

    const remaining = await this.db.conversation.count({
      where: { channelId: sourceChannelId }
    });

    return { moved: movedConversations.count, remaining };
  }

  private async reindexMovedMessages(conversationIds: string[]): Promise<void> {
    const messages = await this.db.message.findMany({
      where: { conversationId: { in: conversationIds }, isDeleted: false },
      select: { messageId: true }
    });

    if (messages.length === 0) {
      return;
    }

    await Promise.all(
      messages.map(message =>
        vespaQueue
          .addJob({ schema: messageSchema, jobType: 'feed', docId: message.messageId })
          .catch(error =>
            logger.error(
              `Failed to queue Vespa re-index for moved message ${message.messageId}:`,
              error
            )
          )
      )
    );
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
