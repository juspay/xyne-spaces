import { DatabaseClient } from '@/database/client';
import { PrismaClient } from '@prisma/client';

export class MessageSearchRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Delete a message from the search index
   * 
   * Uses Prisma client for type-safe database operations
   */
  async delete(messageId: string): Promise<void> {
    await this.db.messageSearch.delete({
      where: { messageId }
    });
  }
}
