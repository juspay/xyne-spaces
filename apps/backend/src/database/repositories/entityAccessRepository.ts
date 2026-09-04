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
   * Active share for a viewer, matched via direct userId share OR via
   * membership in a shared userGroupId/channelId (mirrors CallsACL.canSelect).
   */
  findActiveForViewer(params: {
    workspaceId: string;
    shareableEntityType: string;
    entityId: string;
    userId: string;
    userGroupIds: string[];
    channelIds: string[];
  }): Promise<EntityAccess | null> {
    const { workspaceId, shareableEntityType, entityId, userId, userGroupIds, channelIds } = params;
    return this.db.entityAccess.findFirst({
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

  listForResource(params: {
    workspaceId: string;
    shareableEntityType: string;
    entityId: string;
    includeRevoked?: boolean;
  }): Promise<EntityAccess[]> {
    const { includeRevoked = false, ...where } = params;
    return this.db.entityAccess.findMany({
      where: {
        ...where,
        ...(includeRevoked ? {} : { entityUserAccess: { not: EntityUserAccess.REVOKED } }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  upsert(params: {
    workspaceId: string;
    shareableEntityType: string;
    entityId: string;
    userId: string;
    entityUserAccess: string;
  }): Promise<EntityAccess> {
    const { workspaceId, shareableEntityType, entityId, userId, ...values } = params;
    const updatedAt = new Date();
    return this.db.entityAccess.upsert({
      where: {
        workspaceId_shareableEntityType_entityId_userId: {
          workspaceId,
          shareableEntityType,
          entityId,
          userId,
        },
      },
      create: { ...params, updatedAt },
      update: {
        entityUserAccess: values.entityUserAccess,
        updatedAt,
      },
    });
  }

  update(
    id: string,
    data: Pick<Prisma.EntityAccessUpdateInput, 'entityUserAccess'>
  ): Promise<EntityAccess> {
    return this.db.entityAccess.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
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
