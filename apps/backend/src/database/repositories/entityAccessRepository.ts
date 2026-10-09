import type { Prisma, EntityAccess } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { EntityUserAccess } from '@xyne/shared';

export interface EntityAccessKey {
  workspaceId: string;
  shareableEntityType: string;
  entityId: string;
  userId: string;
}

export class EntityAccessRepository {
  private readonly db = DatabaseClient.getInstance();

  findByKey(key: EntityAccessKey): Promise<EntityAccess | null> {
    return this.db.entityAccess.findUnique({
      where: {
        workspaceId_shareableEntityType_entityId_userId: key,
      },
    });
  }

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

  /**
   * Removals run first: if the process dies between the two statements the caller has lost
   * access rather than kept access it was meant to lose. Deliberately not a transaction —
   * the ACL extension passes straight through inside one (`tenant/acl-extension.ts:188`),
   * so staying outside keeps its scoping.
   */
  async applyDeltaForUser(params: {
    workspaceId: string;
    shareableEntityType: string;
    userId: string;
    added: string[];
    removed: string[];
    entityUserAccess: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    const { workspaceId, shareableEntityType, userId, added, removed, entityUserAccess, metadata } =
      params;
    const scope = { workspaceId, shareableEntityType, userId };

    if (removed.length) {
      await this.db.entityAccess.deleteMany({
        where: { ...scope, entityId: { in: removed } },
      });
    }

    if (added.length) {
      await this.db.entityAccess.createMany({
        data: added.map(entityId => ({
          ...scope,
          entityId,
          entityUserAccess,
          updatedAt: new Date(),
          ...(metadata !== undefined ? { metadata } : {}),
        })),
        skipDuplicates: true,
      });
    }
  }
}
