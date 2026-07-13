import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, type UserGroup } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { canManageUserGroup, hasUserGroupsAdminAccess } from '../core/admin-access';
import { zql } from '../../queries';

export async function getUserGroupInWorkspaceOrThrow(
  userGroupId: string,
  workspaceId: string,
  tx: Transaction<Schema>,
  existingUserGroup?: UserGroup
): Promise<UserGroup> {
  const userGroup = existingUserGroup ?? await tx.run(zql.user_groups.where('id', userGroupId).one());
  if (!userGroup || userGroup.workspaceId !== workspaceId) {
    throw new MutationACLError('User group not found in this workspace', 'user_groups');
  }
  return userGroup;
}

export class UserGroupsACL extends BaseACL<'user_groups'> {
  async canInsert(args: InsertValue<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User group not found in this workspace', 'user_groups');
    }
    // Only ADMIN can create a user group
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!hasAdminAccess) {
      throw new MutationACLError('User group creation failed: only ADMIN access allowed', 'user_groups');
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'user_groups'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const userGroup = await getUserGroupInWorkspaceOrThrow(args.id, this.ctx.workspaceId, tx);

    if (args.workspaceId !== undefined && args.workspaceId !== userGroup.workspaceId) {
      throw new MutationACLError(
        'User group update failed: workspace cannot be changed',
        'user_groups'
      );
    }
    if (args.createdBy !== undefined && args.createdBy !== userGroup.createdBy) {
      throw new MutationACLError(
        'User group update failed: creator cannot be changed',
        'user_groups'
      );
    }

    const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'details');
    if (!canManage) {
      throw new MutationACLError(
        'User group update failed: only the creator or ADMIN access allowed',
        'user_groups'
      );
    }
  }

  async canDelete(args: DeleteID<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    await getUserGroupInWorkspaceOrThrow(args.id, this.ctx.workspaceId, tx);
    // Only ADMIN access to the USER-GROUPS resource can control user groups
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!hasAdminAccess) {
      throw new MutationACLError('User group delete failed: only ADMIN access allowed', 'user_groups');
    }
  }
}
