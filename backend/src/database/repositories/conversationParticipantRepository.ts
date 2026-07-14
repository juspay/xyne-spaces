import { BaseRepository } from './base';
import { ConversationParticipant, ConversationParticipation } from '@prisma/client';
import { QueryOptions } from '@/types/database';

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

    return await this.db.conversationParticipant.create({
      data: {
        conversationId: data.conversationId,
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

    return await this.db.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      create: {
        conversationId,
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

    return participant?.participationType ?? null;
  }
}
