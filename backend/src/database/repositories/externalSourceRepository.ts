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
    channelId?: string | null;
    boardId?: string | null; // Target board for ticket creation
    ownerUserId?: string | null;
    credentials: string; // Encrypted credentials
  }) {
    return await this.db.externalSource.create({
      data: {
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        channelId: data.channelId,
        boardId: data.boardId,
        ownerUserId: data.ownerUserId,
        credentials: data.credentials,
        isActive: true,
      }
    });
  }

  /**
   * Update external source
   */
  async update(id: string, data: {
    displayName?: string;
    channelId?: string | null;
    boardId?: string | null;
    ownerUserId?: string | null;
    isActive?: boolean;
  }) {
    return await this.db.externalSource.update({
      where: { id },
      data
    });
  }

  /**
   * Update encrypted credentials payload for an external source
   */
  async updateCredentials(id: string, credentials: string) {
    return await this.db.externalSource.update({
      where: { id },
      data: { credentials }
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
