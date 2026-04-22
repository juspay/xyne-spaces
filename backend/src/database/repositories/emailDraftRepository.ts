import { DatabaseClient } from '../client';
import { EmailDraft } from '@prisma/client';

export class EmailDraftRepository {
  private db = DatabaseClient.getInstance();

  async create(data: {
    conversationId: string;
    draftContent: string;
    userId: string;
  }): Promise<EmailDraft> {
    if (!data.conversationId) {
      throw new Error('conversationId is required');
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
        draftContent: data.draftContent,
        userId: data.userId,
      },
    });
  }

  async findByConversationId(conversationId: string): Promise<EmailDraft | null> {
    return await this.db.emailDraft.findFirst({
      where: {
        conversationId,
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

