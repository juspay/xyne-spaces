import { DatabaseClient } from '../client';
import { EmailDraft } from '@prisma/client';

export class EmailDraftRepository {
  private db = DatabaseClient.getInstance();

  async create(data: {
    conversationId: string;
    channelId: string;
    draftContent: string;
    userId: string;
  }): Promise<EmailDraft> {
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }
    if (!data.channelId) {
      throw new Error('channelId is required');
    }
    if (!data.draftContent) {
      throw new Error('draftContent is required');
    }
    if (!data.userId) {
      throw new Error('userId is required');
    }

    return await this.db.emailDraft.create({
      data: {
        conversationId: data.conversationId,
        channelId: data.channelId,
        draftContent: data.draftContent,
        userId: data.userId,
      },
    });
  }

  // Upsert a draft scoped to a channel + conversation (no user). There's no
  // unique index on (channelId, conversationId), so this finds-then-writes.
  async upsertForChannelConversation(data: {
    channelId: string;
    conversationId: string;
    draftContent: string;
  }): Promise<EmailDraft> {
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }
    if (!data.channelId) {
      throw new Error('channelId is required');
    }
    if (!data.draftContent) {
      throw new Error('draftContent is required');
    }

    const existing = await this.db.emailDraft.findFirst({
      where: { channelId: data.channelId, conversationId: data.conversationId },
    });
    if (existing) {
      return await this.db.emailDraft.update({
        where: { id: existing.id },
        data: { draftContent: data.draftContent },
      });
    }
    return await this.db.emailDraft.create({
      data: {
        channelId: data.channelId,
        conversationId: data.conversationId,
        draftContent: data.draftContent,
      },
    });
  }

  async findByConversationId(conversationId: string): Promise<EmailDraft | null> {
    return await this.db.emailDraft.findFirst({
      where: {
        conversationId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.db.emailDraft.deleteMany({
      where: {
        id,
      },
    });
  }

  async deleteByConversationId(conversationId: string): Promise<void> {
    await this.db.emailDraft.deleteMany({
      where: {
        conversationId,
      },
    });
  }
}
