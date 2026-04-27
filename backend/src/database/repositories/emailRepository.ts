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
    channelId: string;
    externalThreadId: string;
    externalMessageId: string;
    createdAt?: Date;
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
        channelId: data.channelId,
        externalThreadId: data.externalThreadId,
        externalMessageId: data.externalMessageId,
        ...(data.createdAt && { createdAt: data.createdAt }),
      },
    });
  }

  async findById(id: string): Promise<Email | null> {
    return await this.db.email.findUnique({
      where: { id },
    });
  }

  async findByExternalMessageId(externalMessageId: string): Promise<Email | null> {
    return await this.db.email.findUnique({
      where: { externalMessageId },
    });
  }

  async findByConversationId(conversationId: string): Promise<Email[]> {
    return await this.db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByConversationIdOrdered(conversationId: string): Promise<Email[]> {
    return await this.db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findFirstByConversationId(conversationId: string): Promise<Email | null> {
    return await this.db.email.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findManyWithCursor(
    conversationId: string,
    limit: number,
    cursor?: { id: string; createdAt: number }
  ): Promise<Email[]> {
    const where: any = { conversationId };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: new Date(cursor.createdAt),
          id: { lt: cursor.id },
        },
      ];
    }

    return await this.db.email.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async findRootsByExternalThreadIds(
    externalThreadIds: string[]
  ): Promise<Array<{ id: string; externalThreadId: string }>> {
    if (externalThreadIds.length === 0) return [];

    return await this.db.email.findMany({
      where: { externalThreadId: { in: externalThreadIds }, type: EmailType.DEFAULT },
      orderBy: { createdAt: 'asc' },
      select: { id: true, externalThreadId: true },
    });
  }

  async updateConversationId(emailId: string, conversationId: string): Promise<Email> {
    return await this.db.email.update({
      where: { id: emailId },
      data: { conversationId },
    });
  }

  async updateManyConversationIds(emailIds: string[], conversationId: string): Promise<{ count: number }> {
    return await this.db.email.updateMany({
      where: { id: { in: emailIds } },
      data: { conversationId },
    });
  }

  async delete(id: string): Promise<Email> {
    return await this.db.email.delete({
      where: { id },
    });
  }
}

