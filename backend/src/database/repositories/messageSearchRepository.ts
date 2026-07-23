import { DatabaseClient } from '@/database/client';
import { PrismaClient } from '@prisma/client';

export class MessageSearchRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Insert or update a message in the search index
   * 
   * SECURITY: Uses parameterized queries to prevent SQL injection
   */
  async upsert(messageId: string, plaintextContent: string, workspaceId: string): Promise<void> {
    await this.db.$executeRawUnsafe(`
      INSERT INTO message_search ("messageId", "plaintextContent", "workspaceId", "searchVector", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, to_tsvector('english', $2), NOW(), NOW())
      ON CONFLICT ("messageId") DO UPDATE
      SET "plaintextContent" = EXCLUDED."plaintextContent",
          "workspaceId" = EXCLUDED."workspaceId",
          "searchVector" = to_tsvector('english', EXCLUDED."plaintextContent"),
          "updatedAt" = NOW()
    `, messageId, plaintextContent, workspaceId);
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
