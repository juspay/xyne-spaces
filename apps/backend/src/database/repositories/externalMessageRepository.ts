/**
 * External Message Repository
 * Database operations for ExternalMessage model
 */

import { DatabaseClient } from '../client';
import { MessageDirection, ExternalEntityType, Prisma } from '@prisma/client';

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
   * Scoped to a specific external source
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
   * Batch lookup: return any existing external messages for the given external IDs.
   * Used by manual reload to skip already-ingested messages without a provider API call.
   */
  async findByExternalIds(externalSourceId: string, externalIds: string[]) {
    if (externalIds.length === 0) return [];
    return await this.db.externalMessage.findMany({
      where: {
        externalSourceId,
        externalId: { in: externalIds },
      },
      select: { externalId: true, direction: true },
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

    try {
      // entityId references either a Message (default/MESSAGE) or an Email (EMAIL) row
      // depending on entityType. Both carry a nullable denormalized workspaceId, so fall
      // back to a NOT-NULL ancestor (Email -> Channel; Message -> Conversation -> Channel;
      // Channel.workspaceId is NOT NULL) rather than throwing/leaking for un-backfilled rows.
      let workspaceId: string;
      if (data.entityType === ExternalEntityType.EMAIL) {
        const email = await this.db.email.findUnique({
          where: { id: data.entityId },
          select: { workspaceId: true, channel: { select: { workspaceId: true } } },
        });
        if (!email) {
          throw new Error(`workspaceId required: email ${data.entityId} not found`);
        }
        workspaceId = email.workspaceId ?? email.channel.workspaceId;
      } else {
        const message = await this.db.message.findUnique({
          where: { messageId: data.entityId },
          select: {
            workspaceId: true,
            conversation: {
              select: { workspaceId: true, channel: { select: { workspaceId: true } } },
            },
          },
        });
        if (!message) {
          throw new Error(`workspaceId required: message ${data.entityId} not found`);
        }
        workspaceId =
          message.workspaceId ??
          message.conversation.workspaceId ??
          message.conversation.channel.workspaceId;
      }

      return await this.db.externalMessage.create({
        data: {
          externalSourceId: data.externalSourceId,
          externalId: data.externalId,
          externalThreadId: data.externalThreadId,
          messageId: data.entityId,
          workspaceId,
          direction: data.direction,
          entityId: data.entityId,
          ...(data.entityType && { entityType: data.entityType }),
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByExternalId(data.externalSourceId, data.externalId);
        if (existing) return existing;
      }
      throw error;
    }
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
