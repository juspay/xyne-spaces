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
   * @deprecated ownerUserId - Use EmailChannelPreference table instead
   */
  async create(data: {
    name: string;
    sourceType: string;
    displayName: string;
    channelId: string;
    boardId?: string; // Target board for ticket creation
    credentials: string; // Encrypted credentials
    ownerUserId?: string; // @deprecated - Use EmailChannelPreference table instead
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
   * @deprecated ownerUserId - Use EmailChannelPreference table instead
   */
  async update(id: string, data: {
    displayName?: string;
    channelId?: string;
    boardId?: string;
    isActive?: boolean;
    credentials?: string;
    lastSyncCursor?: string | null;
    ownerUserId?: string; // @deprecated - Use EmailChannelPreference table instead
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

  /**
   * Find active email external source (Google/Microsoft) for a workspace.
   */
  async findEmailSourceByWorkspaceId(workspaceId: string) {
    return await this.db.externalSource.findFirst({
      where: { workspaceId, sourceType: { in: ['google', 'microsoft'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find a Google-backed source by the connected mailbox address.
   * Prefers the separate channel-email source over the legacy desk source.
   */
  async findGoogleSourceByDisplayEmail(displayEmail: string) {
    const normalized = displayEmail.trim().toLowerCase();
    const channelEmailSource = await this.db.externalSource.findFirst({
      where: {
        displayName: { equals: normalized, mode: 'insensitive' },
        sourceType: 'google-channel-email',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (channelEmailSource) {
      return channelEmailSource;
    }

    return await this.db.externalSource.findFirst({
      where: {
        displayName: { equals: normalized, mode: 'insensitive' },
        sourceType: 'google',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
