import type { ExternalMessage } from '@prisma/client';
import { ExternalMessageRepository, MessageDirection, db } from '../../../re-exports';

/** Spaces ⇄ provider message map; reads include older migrations' sources, writes go to the link's own. */
export class MessageMapRepository {
  private readonly externalMessages = new ExternalMessageRepository();

  async findByExternalId(sourceIds: string[], externalId: string): Promise<ExternalMessage | null> {
    return await db.externalMessage.findFirst({
      where: { externalSourceId: { in: sourceIds }, externalId },
    });
  }

  /** The earliest message already mapped in this provider thread. */
  async findByThreadId(sourceIds: string[], threadId: string): Promise<ExternalMessage | null> {
    return await db.externalMessage.findFirst({
      where: { externalSourceId: { in: sourceIds }, externalThreadId: threadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByMessageId(sourceIds: string[], messageId: string): Promise<ExternalMessage | null> {
    return await db.externalMessage.findFirst({
      where: { externalSourceId: { in: sourceIds }, messageId },
    });
  }

  async create(data: {
    sourceId: string;
    externalId: string;
    threadId: string;
    messageId: string;
    direction: MessageDirection;
  }): Promise<ExternalMessage> {
    return await this.externalMessages.create({
      externalSourceId: data.sourceId,
      externalId: data.externalId,
      externalThreadId: data.threadId,
      entityId: data.messageId,
      direction: data.direction,
    });
  }
}
