import { BaseRepository } from './base';
import { ConversationParticipant, ConversationParticipation } from '@prisma/client';
import { QueryOptions } from '@/types/database';

export interface CreateConversationParticipantInput {
  conversationId: string;
  userId: string;
  participationType?: ConversationParticipation;
}

export interface UpdateConversationParticipantInput {
  participationType?: ConversationParticipation;
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

    return await this.db.conversationParticipant.create({
      data: {
        conversationId: data.conversationId,
        userId: data.userId,
        participationType: data.participationType ?? ConversationParticipation.MENTIONED,
      },
    });
  }

  async createOrUpdateConversationParticipant(
    conversationId: string,
    userId: string,
    participationType: ConversationParticipation
  ): Promise<ConversationParticipant> {
    await this.validateString(conversationId, 'conversationId');
    await this.validateString(userId, 'userId');
    await this.validateEnum(participationType, 'participationType', ['AUTHOR', 'MENTIONED']);

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
      },
      update: {
        participationType,
      },
    });
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
