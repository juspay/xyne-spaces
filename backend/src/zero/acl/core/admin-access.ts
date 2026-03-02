import { Transaction } from '@rocicorp/zero';
import { Schema, AccessType, UserResponsibility } from '@xyne/shared';
import { zql } from '../../queries';
import { MutationACLError, TableName } from './types';

/**
 * Checks if the current user has ADMIN access to the PROJECTS resource (direct or via group).
 */
export async function hasProjectAdminAccess(ctx: { userID: string }, tx: Transaction<Schema>): Promise<boolean> {
  const projectsResource = await tx.run(
    (zql.resources).where('name', 'LISTPROJECTS').one()
  );
  if (!projectsResource) return false;

  // Direct user access
  const directAccess = await tx.run(
    (zql.resource_access)
      .where('userId', ctx.userID)
      .where('resourceId', projectsResource.id)
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
        .where('resourceId', projectsResource.id)
        .where('accessType', AccessType.ADMIN)
        .where(helpers => helpers.cmp('groupId', 'IN', groupIds))
        .one()
    );
    if (groupAccess) return true;
  }
  return false;
}

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

export async function verifyManagerOrTeamLead(ctx: { userID: string }, userGroupId: string, tx: Transaction<Schema>, tableName: TableName = 'user_group_mappings'): Promise<void> {
  const requesterMapping = await tx.run(
    zql.user_group_mappings
      .where('userGroupId', userGroupId)
      .where('userId', ctx.userID)
      .one()
  );
    
  if (!requesterMapping) {
    throw new MutationACLError('Operation failed: you must be a member of the group', tableName);
  }

  if (requesterMapping.responsibility !== UserResponsibility.MANAGER && 
      requesterMapping.responsibility !== UserResponsibility.TEAM_LEAD) {
    throw new MutationACLError('Operation failed: only MANAGER or TEAM_LEAD can perform this operation', tableName);
  }
}
