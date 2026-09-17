import type { Prisma, EntityAccess } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { EntityUserAccess } from '@xyne/shared';

export class EntityAccessRepository {
  private readonly db = DatabaseClient.getInstance();

  findActiveByUser(params: {
    workspaceId: string;
    shareableEntityType: string;
    userId: string;
  }): Promise<EntityAccess[]> {
    return this.db.entityAccess.findMany({
      where: {
        ...params,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Every active grant reaching a viewer — directly, or through a group or
   * channel they belong to. The full set rather than the first match, so a
   * caller can rank the levels and take the strongest (a channel VIEW grant
   * plus a direct EDIT grant is an edit).
   *
   * `tx` lets the read join a caller's transaction; it defaults to the shared
   * client for ordinary request-path reads.
   */
  listActiveForViewer(
    params: {
      workspaceId: string;
      shareableEntityType: string;
      entityId: string;
      userId: string;
      userGroupIds: string[];
      channelIds: string[];
    },
    tx?: Prisma.TransactionClient
  ): Promise<EntityAccess[]> {
    const { workspaceId, shareableEntityType, entityId, userId, userGroupIds, channelIds } = params;
    return (tx ?? this.db).entityAccess.findMany({
      where: {
        workspaceId,
        shareableEntityType,
        entityId,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId },
          ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ],
      },
    });
  }

  deleteForResource(shareableEntityType: string, entityId: string): Promise<Prisma.BatchPayload> {
    return this.db.entityAccess.deleteMany({
      where: { shareableEntityType, entityId },
    });
  }
}
