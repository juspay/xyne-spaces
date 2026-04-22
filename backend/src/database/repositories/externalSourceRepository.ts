/**
 * External Source Repository
 * Database operations for ExternalSource model
 */

import { DatabaseClient } from '../client';

export class ExternalSourceRepository {
  private db = DatabaseClient.getInstance();

  /**
   * Find external source by name
   * Returns raw source with encrypted credentials
   */
  async findByName(name: string) {
    return await this.db.externalSource.findUnique({
      where: { name }
    });
  }

  /**
   * Find external source by ID
   * Returns raw source with encrypted credentials
   */
  async findById(id: string) {
    return await this.db.externalSource.findUnique({
      where: { id }
    });
  }

  /**
   * Create external source
   * @param data.credentials - Encrypted credentials string (use encrypt() from encryptionService)
   * @param data.boardId - Optional target board for ticket creation
   */
  async create(data: {
    name: string;
    sourceType: string;
    displayName: string;
    channelId: string;
    boardId?: string; // Target board for ticket creation
    credentials: string; // Encrypted credentials
    ownerUserId?: string; // Channel creator — author for auto-created tickets
  }) {
    return await this.db.externalSource.create({
      data: {
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        channelId: data.channelId,
        boardId: data.boardId,
        credentials: data.credentials,
        ownerUserId: data.ownerUserId,
        isActive: true,
      }
    });
  }

  /**
   * Update external source
   */
  async update(id: string, data: {
    displayName?: string;
    channelId?: string;
    boardId?: string;
    isActive?: boolean;
    credentials?: string;
    lastSyncCursor?: string | null;
    ownerUserId?: string;
  }) {
    return await this.db.externalSource.update({
      where: { id },
      data
    });
  }

  /**
   * Delete external source
   */
  async delete(id: string) {
    return await this.db.externalSource.delete({
      where: { id }
    });
  }

  /**
   * List all external sources
   */
  async findAll(filter?: {
    sourceType?: string;
    isActive?: boolean;
  }) {
    return await this.db.externalSource.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Count messages for a source
   */
  async getMessageCount(sourceId: string): Promise<number> {
    return await this.db.externalMessage.count({
      where: { externalSourceId: sourceId }
    });
  }

  /**
   * Find external source by channel ID
   */
  async findByChannelId(channelId: string) {
    return await this.db.externalSource.findFirst({
      where: { channelId }
    });
  }
}
