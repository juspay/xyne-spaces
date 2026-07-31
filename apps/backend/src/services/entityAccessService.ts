import type { EntityAccess } from '@prisma/client';
import { repositories } from '@/database/repositories';
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
  hasActiveShare(params: {
    workspaceId: string;
    shareableEntityType: ShareableEntityType;
    entityId: string;
    userId: string;
  }): Promise<boolean> {
    return repositories.entityAccess
      .findByKey(params)
      .then((share) => Boolean(share && share.entityUserAccess !== EntityUserAccess.REVOKED));
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
