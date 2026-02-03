import { Transaction } from '@rocicorp/zero';
import { Schema, AccessType } from '@xyne/shared';
import { zql } from '../../queries';

/**
 * Checks if the current user has ADMIN access to the USER-GROUPS resource (direct or via group).
 */
export async function hasUserGroupsAdminAccess(ctx: { userID: string }, tx: Transaction<Schema>): Promise<boolean> {
  const userGroupsResource = await tx.run(
    (zql.resources).where('name', 'USER-GROUPS').one()
  );
  if (!userGroupsResource) return false;

  // Direct user access
  const directAccess = await tx.run(
    (zql.resource_access)
      .where('userId', ctx.userID)
      .where('resourceId', userGroupsResource.id)
      .where('accessType', AccessType.ADMIN)
      .one()
  );
  if (directAccess) return true;

  // Group-based access
  const userGroups = await tx.run(
    (zql.user_group_mappings).where('userId', ctx.userID)
  );
  if (userGroups && userGroups.length > 0) {
    const groupIds = userGroups.map(g => g.userGroupId);
    const groupAccess = await tx.run(
      (zql.resource_access)
        .where('resourceId', userGroupsResource.id)
        .where('accessType', AccessType.ADMIN)
        .where(helpers => helpers.cmp('groupId', 'IN', groupIds))
        .one()
    );
    if (groupAccess) return true;
  }
  return false;
}
