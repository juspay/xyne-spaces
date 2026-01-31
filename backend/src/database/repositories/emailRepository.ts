import { DatabaseClient } from '../client';
import { Email, EmailType } from '@prisma/client';

export class EmailRepository {
  private db = DatabaseClient.getInstance();

  async create(data: {
    type: EmailType;
    subject: string;
    body: string;
    to: string[];
    from: string;
    cc?: string[];
    bcc?: string[];
    conversationId: string;
    externalThreadId: string;
    externalMessageId: string;
  }): Promise<Email> {
    if (!data.to || data.to.length === 0) {
      throw new Error('At least one recipient is required');
    }

    return await this.db.email.create({
      data: {
        type: data.type,
        subject: data.subject,
        body: data.body,
        to: data.to,
        from: data.from,
        cc: data.cc || [],
        bcc: data.bcc || [],
        conversationId: data.conversationId,
        externalThreadId: data.externalThreadId,
        externalMessageId: data.externalMessageId,
      },
    });
  }

  async findById(id: string): Promise<Email | null> {
    return await this.db.email.findUnique({
      where: { id },
    });
  }

  async findByConversationId(conversationId: string): Promise<Email[]> {
    return await this.db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

