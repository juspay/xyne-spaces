/**
 * External Message Repository
 * Database operations for ExternalMessage model
 */

import { DatabaseClient } from '../client';
import { Prisma } from '@prisma/client';
import { MessageDirection, ExternalEntityType } from '@xyne/shared';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';

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
   * Any link on these emails owned by a source OTHER than the given one — i.e.
   * "does another integration already own this conversation?". Used to stop the
   * channel-scoped thread fallback from adopting a thread that belongs to a
   * different app, mailbox, or Slack desk on the same channel.
   */
  async findForeignLinkByEmailIds(emailIds: string[], excludeExternalSourceId: string) {
    if (emailIds.length === 0) return null;
    return await this.db.externalMessage.findFirst({
      where: {
        entityType: ExternalEntityType.EMAIL,
        entityId: { in: emailIds },
        externalSourceId: { not: excludeExternalSourceId },
      },
      select: { id: true, externalSourceId: true },
    });
  }

  /** Find the newest app-desk link for the given email (entity) IDs, scoped to the given app-desk source IDs (ExternalMessage has no FK relation to filter by sourceType). */
  async findLatestAppDeskLinkByEmailIds(emailIds: string[], externalSourceIds: string[]) {
    if (emailIds.length === 0 || externalSourceIds.length === 0) return null;
    return await this.db.externalMessage.findFirst({
      where: {
        entityType: ExternalEntityType.EMAIL,
        entityId: { in: emailIds },
        externalSourceId: { in: externalSourceIds },
      },
      orderBy: { createdAt: 'desc' },
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
      // entityId references either a Message (default/MESSAGE) or an Email
      // (EMAIL) row depending on entityType; both carry a denormalized
      // workspaceId we can source from.
      const workspaceId = data.entityType === ExternalEntityType.EMAIL
        ? await resolveWorkspaceIdFromModel(this.db, 'email', { id: data.entityId })
        : await resolveWorkspaceIdFromModel(this.db, 'message', { messageId: data.entityId });

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
