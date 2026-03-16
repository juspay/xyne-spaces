/**
 * External Message Repository
 * Database operations for ExternalMessage model
 */

import { DatabaseClient } from '../client';
import { MessageDirection, ExternalEntityType } from '@prisma/client';

export class ExternalMessageRepository {
  private db = DatabaseClient.getInstance();

  /**
   * Find external message by external ID (for deduplication)
   */
  async findByExternalId(externalSourceId: string, externalId: string) {
    return await this.db.externalMessage.findUnique({
      where: {
        externalSourceId_externalId: {
          externalSourceId,
          externalId
        }
      }
    });
  }

  /**
   * Find external messages by thread ID (to find existing conversation)
   */
  async findByThreadId(externalSourceId: string, externalThreadId: string, entityType?: ExternalEntityType) {
    return await this.db.externalMessage.findFirst({
      where: {
        externalSourceId,
        externalThreadId,
        ...(entityType && { entityType: entityType })
      },
      orderBy: { createdAt: 'asc' }  // Get earliest message
    });
  }

  /**
   * Find external message by message ID
   */
  async findByMessageId(messageId: string) {
    return await this.db.externalMessage.findFirst({
      where: { messageId }
    });
  }

  /**
   * Create external message tracking record
   * entityType is optional (defaults to MESSAGE in schema)
   * entityId is required if entityType is provided
   */
  async create(data: {
    externalSourceId: string;
    externalId: string;
    externalThreadId: string;
    entityId: string;
    direction: MessageDirection;
    entityType?: ExternalEntityType;
  }) {
    if (data.entityType && !data.entityId) {
      throw new Error('entityId is required when entityType is provided');
    }

    return await this.db.externalMessage.create({
      data: {
        externalSourceId: data.externalSourceId,
        externalId: data.externalId,
        externalThreadId: data.externalThreadId,
        messageId: data.entityId,
        direction: data.direction,
        entityId: data.entityId,
        ...(data.entityType && { entityType: data.entityType }),
      }
    });
  }

  /**
   * Find external messages for a source
   */
  async findBySource(externalSourceId: string, limit: number = 100) {
    return await this.db.externalMessage.findMany({
      where: { externalSourceId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  /**
   * Delete external message
   */
  async delete(id: string) {
    return await this.db.externalMessage.delete({
      where: { id }
    });
  }
}
