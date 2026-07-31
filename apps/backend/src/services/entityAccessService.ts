import type { EntityAccess } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import {
  EntityUserAccess,
  type ShareableEntityType,
  type GrantableEntityUserAccess,
} from '@xyne/shared';

export interface ShareEntityInput {
  workspaceId: string;
  shareableEntityType: ShareableEntityType;
  entityId: string;
  userId: string;
  entityUserAccess?: GrantableEntityUserAccess;
}

/**
 * Persistence service for polymorphic entity shares.
 *
 * Domain services must verify that the target entity exists and that the
 * acting user may share it before calling this service.
 */
export class EntityAccessService {
  private readonly db = DatabaseClient.getInstance();

  async hasActiveShare(params: {
    workspaceId: string;
    shareableEntityType: ShareableEntityType;
    entityId: string;
    userId: string;
  }): Promise<boolean> {
    // Direct user share (cheap path, no extra lookups).
    const direct = await repositories.entityAccess.findByKey(params);
    if (direct && direct.entityUserAccess !== EntityUserAccess.REVOKED) {
      return true;
    }

    // Fall back to group/channel membership shares (matches CallsACL.canSelect
    // on the Zero read path).
    const [groupMappings, channelParticipations] = await Promise.all([
      this.db.userGroupMapping.findMany({
        where: { userId: params.userId },
        select: { userGroupId: true },
      }),
      this.db.channelParticipant.findMany({
        where: { userId: params.userId },
        select: { channelId: true },
      }),
    ]);
    const userGroupIds = groupMappings.map(m => m.userGroupId);
    const channelIds = channelParticipations.map(p => p.channelId);

    if (userGroupIds.length === 0 && channelIds.length === 0) {
      return false;
    }

    const viaMembership = await repositories.entityAccess.findActiveForViewer({
      ...params,
      userGroupIds,
      channelIds,
    });
    return Boolean(viaMembership);
  }

  listForResource(params: {
    workspaceId: string;
    shareableEntityType: ShareableEntityType;
    entityId: string;
    includeRevoked?: boolean;
  }): Promise<EntityAccess[]> {
    return repositories.entityAccess.listForResource(params);
  }

  share(input: ShareEntityInput): Promise<EntityAccess> {
    return repositories.entityAccess.upsert({
      ...input,
      entityUserAccess: input.entityUserAccess ?? EntityUserAccess.VIEW,
    });
  }

  async update(params: {
    workspaceId: string;
    shareableEntityType: ShareableEntityType;
    entityId: string;
    userId: string;
    entityUserAccess?: EntityUserAccess;
  }): Promise<EntityAccess | null> {
    const share = await repositories.entityAccess.findByKey(params);
    if (!share || share.workspaceId !== params.workspaceId) return null;

    return repositories.entityAccess.update(share.id, {
      ...(params.entityUserAccess ? { entityUserAccess: params.entityUserAccess } : {}),
    });
  }
}

export const entityAccessService = new EntityAccessService();
