import { db } from '@/database/client';
import { removeServiceAccountResource } from '@/bypassAcl/serviceAccountServices';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import type { ServiceAccountResourceType } from '../constants';
import { ServiceAccountError } from '../errors';
import { ownedUserPrefix } from '../ownership';
import { resourceType } from '../resources';
import { ServiceAccountAdminPolicy, resourcesOf, toView, type Caller, type ServiceAccountView } from './access';

/** Needs admin of each resource, not of the account: anyone can hand their channel to an account. */
export function connectResources(
  caller: Caller,
  id: string,
  type: ServiceAccountResourceType,
  ids: string[],
): Promise<ServiceAccountView> {
  return withWorkspaceScope(async () => {
    const policy = new ServiceAccountAdminPolicy(caller);
    const { account } = await policy.load(id);
    const unique = [...new Set(ids)];
    await policy.assertCanConnect(type, unique);
    await db.serviceAccountResource.createMany({
      data: unique.map((resourceId) => ({
        workspaceId: caller.workspaceId,
        serviceAccountId: id,
        resourceType: type,
        resourceId,
        addedBy: caller.id,
      })),
      skipDuplicates: true,
    });
    logger.info('[service-account] resources connected', { serviceAccountId: id, by: caller.id, type, ids: unique });
    return toView(account, await resourcesOf(id));
  });
}

/** Also takes it away from users the account gave it to; other grants are left alone. */
export function disconnectResource(
  caller: Caller,
  id: string,
  type: ServiceAccountResourceType,
  resourceId: string,
): Promise<ServiceAccountView> {
  return withWorkspaceScope(async () => {
    const policy = new ServiceAccountAdminPolicy(caller);
    const { account, resources } = await policy.load(id);
    if (!resources.some((r) => r.type === type && r.id === resourceId)) {
      throw new ServiceAccountError('not_found', 'That is not connected to this service account.');
    }
    await policy.assertCanDisconnect(account, resources, { type, id: resourceId });

    const definition = resourceType(type);
    const granted = await definition.grantees(caller.workspaceId, resourceId, id);
    const owned = await db.user.findMany({
      where: { workspaceId: caller.workspaceId, id: { in: granted }, providerUserId: { startsWith: ownedUserPrefix(id) } },
      select: { id: true },
    });

    await removeServiceAccountResource({
      workspaceId: caller.workspaceId,
      serviceAccountId: id,
      type,
      resourceId,
      resource: definition,
      userIds: owned.map((user) => user.id),
    });
    logger.info('[service-account] resource disconnected', {
      serviceAccountId: id,
      by: caller.id,
      type,
      resourceId,
      usersRemoved: owned.length,
    });
    return toView(account, resources.filter((r) => !(r.type === type && r.id === resourceId)));
  });
}
