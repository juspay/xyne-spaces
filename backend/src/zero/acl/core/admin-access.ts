import { Transaction } from '@rocicorp/zero';
import { Schema, AccessType, WorkspaceRole } from '@xyne/shared';
import { zql } from '../../queries';
import { MutationACLError, QueryContext } from './types';

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

/**
 * Verify user has ADMIN or OWNER role using context (no DB query needed)
 * Use this when ctx.role is already populated from JWT
 */
export function verifyWorkspaceAdminOrOwnerFromContext(
  ctx: QueryContext,
  tableName: string = 'workspaces'
): void {
  if (ctx.role !== WorkspaceRole.ADMIN && ctx.role !== WorkspaceRole.OWNER) {
    throw new MutationACLError(
      'Admin or Owner access required for this workspace operation',
      tableName
    );
  }
}

/**
 * Assert the current user can manage roles (create / update / delete).
 *
 * Permission model:
 *   - Workspace OWNER or ADMIN implicitly gets ADMIN access to the ROLES resource.
 *   - Any user with WRITE or ADMIN access to the ROLES resource (direct only)
 *     can manage roles.
 */
export async function assertCanManageRoles(
  ctx: QueryContext,
  tx: Transaction<Schema>,
): Promise<void> {
  if (ctx.role === WorkspaceRole.OWNER || ctx.role === WorkspaceRole.ADMIN) {
    return;
  }

  const rolesResource = await tx.run(zql.resources.where('name', 'ROLES').one());
  if (!rolesResource) {
    throw new MutationACLError('ROLES resource is not configured', 'roles');
  }

  const directAccess = await tx.run(
    zql.resource_access
      .where('userId', ctx.userID)
      .where('resourceId', rolesResource.id)
      .where(helpers => helpers.cmp('accessType', 'IN', [AccessType.WRITE, AccessType.ADMIN]))
      .one(),
  );
  if (directAccess) {
    return;
  }

  throw new MutationACLError('Operation failed: ROLES resource access required to manage roles', 'roles');
}

/**
 * Checks if the current user has ADMIN access to the XYNE-APPS resource (direct or via group).
 */
export async function hasXyneAppsAdminAccess(ctx: { userID: string }, tx: Transaction<Schema>): Promise<boolean> {
  const xyneAppsResource = await tx.run(
    (zql.resources).where('name', 'XYNE-APPS').one()
  );
  if (!xyneAppsResource) return false;

  // Direct user access
  const access = await tx.run(
    (zql.resource_access)
      .where('userId', ctx.userID)
      .where('resourceId', xyneAppsResource.id)
      .where('accessType', AccessType.ADMIN)
      .one()
  );

  return !!access;
}
