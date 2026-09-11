import { BaseRepository } from './base';
import { ConversationParticipant, Prisma } from '@prisma/client';
import { ConversationParticipation } from '@xyne/shared';
import { QueryOptions } from '@/types/database';
import { ThreadListCursor, ThreadListSection, ThreadListSort } from '@/utils/threadListCursor';
import { ACLFactory } from '@/database/acl';
import { getContextOrNull } from '@/database/tenant/context';

export interface ThreadListEntry {
  conversationId: string;
  channelId: string;
  sectionAtLoad: ThreadListSection;
}

export interface ThreadListPage {
  threads: ThreadListEntry[];
  nextCursor: ThreadListCursor | null;
  hasMore: boolean;
}

interface ThreadListDatabaseRow {
  id: string;
  conversationId: string;
  conversation: {
    channelId: string;
  };
}

interface ThreadListSectionRow {
  row: ThreadListDatabaseRow;
  section: ThreadListSection;
}

export interface CreateConversationParticipantInput {
  conversationId: string;
  userId: string;
  participationType?: ConversationParticipation;
  isSubscribed?: boolean;
  channelId?: string;
}

export interface UpdateConversationParticipantInput {
  participationType?: ConversationParticipation;
  isSubscribed?: boolean;
}

export interface ConversationParticipantFilters {
  conversationId?: string;
  userId?: string;
  participationType?: ConversationParticipation;
}

export class ConversationParticipantRepository extends BaseRepository<
  ConversationParticipant,
  CreateConversationParticipantInput,
  UpdateConversationParticipantInput
> {
  constructor() {
    super('conversationParticipant');
  }

  async create(data: CreateConversationParticipantInput): Promise<ConversationParticipant> {
    await this.validateString(data.conversationId, 'conversationId');
    await this.validateString(data.userId, 'userId');

    if (data.participationType) {
      await this.validateEnum(data.participationType, 'participationType', ['AUTHOR', 'MENTIONED']);
    }

    const channelId = data.channelId ?? await this.resolveConversationChannelId(data.conversationId);
    const workspaceId = await this.resolveConversationWorkspaceId(data.conversationId);

    return await this.db.conversationParticipant.create({
      data: {
        conversationId: data.conversationId,
        workspaceId,
        userId: data.userId,
        participationType: data.participationType ?? null, // Can be AUTHOR, MENTIONED, or null (manual subscription)
        isSubscribed: data.isSubscribed ?? true, // Default to subscribed
        ...(channelId && { channelId }),
      },
    });
  }

  async createOrUpdateConversationParticipant(
    conversationId: string,
    userId: string,
    participationType: ConversationParticipation,
    channelId?: string,
  ): Promise<ConversationParticipant> {
    await this.validateString(conversationId, 'conversationId');
    await this.validateString(userId, 'userId');
    await this.validateEnum(participationType, 'participationType', ['AUTHOR', 'MENTIONED']);

    const resolvedChannelId = channelId ?? await this.resolveConversationChannelId(conversationId);
    const workspaceId = await this.resolveConversationWorkspaceId(conversationId);

    return await this.db.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      create: {
        conversationId,
        workspaceId,
        userId,
        participationType,
        ...(resolvedChannelId && { channelId: resolvedChannelId }),
      },
      update: {
        participationType,
        ...(resolvedChannelId && { channelId: resolvedChannelId }),
      },
    });
  }

  private async resolveConversationChannelId(conversationId: string): Promise<string | undefined> {
    const conversation = await this.db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true },
    });

    return conversation?.channelId;
  }

  private async resolveConversationWorkspaceId(conversationId: string): Promise<string> {
    const conversation = await this.db.conversation.findUniqueOrThrow({
      where: { conversationId },
      select: { workspaceId: true },
    });

    return conversation.workspaceId;
  }

  async findById(id: string): Promise<ConversationParticipant | null> {
    return await this.db.conversationParticipant.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<ConversationParticipant[]>;
  async findMany(filters?: ConversationParticipantFilters): Promise<ConversationParticipant[]>;
  async findMany(
    optionsOrFilters?: QueryOptions | ConversationParticipantFilters
  ): Promise<ConversationParticipant[]> {
    const filters = optionsOrFilters as ConversationParticipantFilters;
    const where: any = {};

    if (filters?.conversationId) {
      where.conversationId = filters.conversationId;
    }

    if (filters?.userId) {
      where.userId = filters.userId;
    }

    if (filters?.participationType) {
      where.participationType = filters.participationType;
    }

    return await this.db.conversationParticipant.findMany({
      where,
      orderBy: { joinedAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: UpdateConversationParticipantInput
  ): Promise<ConversationParticipant> {
    if (data.participationType) {
      await this.validateEnum(data.participationType, 'participationType', ['AUTHOR', 'MENTIONED']);
    }

    return await this.db.conversationParticipant.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ConversationParticipant> {
    return await this.db.conversationParticipant.delete({
      where: { id },
    });
  }

  async findByConversationIdAndUserId(
    conversationId: string,
    userId: string
  ): Promise<ConversationParticipation | null> {
    await this.validateString(conversationId, 'conversationId');
    await this.validateString(userId, 'userId');

    const participant = await this.db.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      select: {
        participationType: true,
      },
    });

    return (participant?.participationType ?? null) as ConversationParticipation;
  }

  /**
   * Returns a non-live page of thread membership for the Threads inbox.
   *
   * Read state is derived from the two timestamps instead of being persisted separately.
   * Each section uses the same Prisma cursor pagination pattern as other API repositories.
   */
  async findUserThreadsPage(
    limit: number,
    cursor: ThreadListCursor | null,
    sort: ThreadListSort = 'sections'
  ): Promise<ThreadListPage> {
    let pageRows: ThreadListSectionRow[];
    let hasMore: boolean;

    // 'recent' mode: a single flat list ordered by lastReplyAt desc, with no
    // read/unread divider and WITHOUT mutating read-state.
    if (sort === 'recent' || cursor?.section === 'recent') {
      const recentRows = await this.findUserThreadSection(
        'recent',
        limit + 1,
        cursor?.participantId
      );
      hasMore = recentRows.length > limit;
      pageRows = recentRows
        .slice(0, limit)
        .map((row) => ({ row, section: 'recent' as const }));
    } else if (cursor?.section === 'read') {
      const readRows = await this.findUserThreadSection(
        'read',
        limit + 1,
        cursor.participantId
      );
      hasMore = readRows.length > limit;
      pageRows = readRows.slice(0, limit).map((row) => ({ row, section: 'read' }));
    } else {
      const unreadRows = await this.findUserThreadSection(
        'unread',
        limit + 1,
        cursor?.participantId
      );

      if (unreadRows.length > limit) {
        hasMore = true;
        pageRows = unreadRows.slice(0, limit).map((row) => ({ row, section: 'unread' }));
      } else {
        const readCapacity = limit - unreadRows.length;
        const readRows = await this.findUserThreadSection('read', readCapacity + 1);
        hasMore = readRows.length > readCapacity;
        pageRows = [
          ...unreadRows.map((row) => ({ row, section: 'unread' as const })),
          ...readRows.slice(0, readCapacity).map((row) => ({ row, section: 'read' as const })),
        ];
      }
    }

    const lastPageRow = pageRows.at(-1);

    return {
      threads: pageRows.map(({ row, section }) => ({
        conversationId: row.conversationId,
        channelId: row.conversation.channelId,
        sectionAtLoad: section,
      })),
      nextCursor:
        hasMore && lastPageRow
          ? {
              section: lastPageRow.section,
              participantId: lastPageRow.row.id,
            }
          : null,
      hasMore,
    };
  }

  private async findUserThreadSection(
    section: ThreadListSection,
    take: number,
    cursorParticipantId?: string
  ): Promise<ThreadListDatabaseRow[]> {
    const tenantContext = getContextOrNull();
    if (!tenantContext || tenantContext.actor === 'system') {
      throw new Error('Authenticated tenant context is required to list user threads');
    }

    const userId = tenantContext.userId;
    const lastReplyAtField = this.db.conversationParticipant.fields.lastReplyAt;
    const sectionWhere: Prisma.ConversationParticipantWhereInput =
      section === 'recent'
        ? {}
        : section === 'unread'
        ? {
            OR: [
              { lastReadAt: null },
              { lastReadAt: { lt: lastReplyAtField } },
            ],
          }
        : {
            lastReadAt: {
              not: null,
              gte: lastReplyAtField,
            },
          };

    const userChannels = await this.db.channelParticipant.findMany({
      where: { userId },
      select: { channelId: true },
    });
    const joinedChannelIds = userChannels.map((c) => c.channelId);

    const acl = ACLFactory.getACL('conversationParticipant', tenantContext, this.db);
    const where = await acl.applyToWhere({
      userId,
      isSubscribed: true,
      lastReplyAt: { not: null },
      // We check `conversation.channelId` explicitly. The `is` safely ignores
      // cases where the conversation record itself might be missing (orphaned).
      conversation: {
        is: {
          channelId: { in: joinedChannelIds }
        }
      },
      ...sectionWhere,
    });

    return this.db.conversationParticipant.findMany({
      where,
      orderBy: [{ lastReplyAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursorParticipantId
        ? {
            cursor: { id: cursorParticipantId },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        conversationId: true,
        conversation: {
          select: { channelId: true },
        },
      },
    });
  }
}
