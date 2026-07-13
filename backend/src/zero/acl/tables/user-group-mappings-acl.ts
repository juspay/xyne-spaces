import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { canManageUserGroup } from '../core/admin-access';
import { getUserInWorkspaceOrThrow } from './users-acl';
import { getRoleInWorkspaceOrThrow } from './roles-acl';
import { getUserGroupInWorkspaceOrThrow } from './user-groups-acl';

export class UserGroupMappingsACL extends BaseACL<'user_group_mappings'> {
  async canInsert(args: InsertValue<TableSchema<'user_group_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Check if the user group exists
    const userGroup = await tx.run(
      zql.user_groups
        .where('id', args.userGroupId)
        .one()
    );

    if (!userGroup) {
      throw new MutationACLError('User group mapping insert failed: the specified group does not exist', 'user_group_mappings');
    }
    await getUserGroupInWorkspaceOrThrow(args.userGroupId, this.ctx.workspaceId, tx, userGroup);
    await getUserInWorkspaceOrThrow(args.userId, this.ctx.workspaceId, tx);
    if (args.roleId) {
      await getRoleInWorkspaceOrThrow(args.roleId, this.ctx.workspaceId, tx);
    }

    const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'members');
    if (!canManage) {
      throw new MutationACLError(
        'User group mapping insert failed: only the creator of a group without resource grants or ADMIN access allowed',
        'user_group_mappings'
      );
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_group_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the mapping being updated
    const userGroupMapping = await tx.run(
      zql.user_group_mappings
        .where('id', args.id)
        .one()
    );

    if (!userGroupMapping) {
      throw new MutationACLError('User group mapping update failed: the mapping does not exist', 'user_group_mappings');
    }
    if (
      (args.userId !== undefined && args.userId !== userGroupMapping.userId) ||
      (args.userGroupId !== undefined && args.userGroupId !== userGroupMapping.userGroupId)
    ) {
      throw new MutationACLError(
        'User group mapping update failed: user and group cannot be reassigned',
        'user_group_mappings'
      );
    }
    const userGroup = await getUserGroupInWorkspaceOrThrow(
      userGroupMapping.userGroupId,
      this.ctx.workspaceId,
      tx
    );
    if (args.roleId) {
      await getRoleInWorkspaceOrThrow(args.roleId, this.ctx.workspaceId, tx);
    }

    const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'members');
    if (!canManage) {
      throw new MutationACLError(
        'User group mapping update failed: only the creator of a group without resource grants or ADMIN access allowed',
        'user_group_mappings'
      );
    }
  }

  async canDelete(args: DeleteID<TableSchema<'user_group_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the mapping being deleted
    const userGroupMapping = await tx.run(
      zql.user_group_mappings
        .where('id', args.id)
        .one()
    );

    if (!userGroupMapping) {
      throw new MutationACLError('User group mapping delete failed: the mapping does not exist', 'user_group_mappings');
    }
    const userGroup = await getUserGroupInWorkspaceOrThrow(
      userGroupMapping.userGroupId,
      this.ctx.workspaceId,
      tx
    );

    const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'members');
    if (!canManage) {
      throw new MutationACLError(
        'User group mapping delete failed: only the creator of a group without resource grants or ADMIN access allowed',
        'user_group_mappings'
      );
    }
  }
}
