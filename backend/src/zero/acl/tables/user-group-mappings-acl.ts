import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasUserGroupsAdminAccess, verifyManagerOrTeamLead } from '../core/admin-access';

export class UserGroupMappingsACL extends BaseACL<'user_group_mappings'> {

  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const userGroupWorkspaceId = workspaceId ?? await tx.run(zql.user_groups.where('id', userGroupId).one()).then(ug => ug?.workspaceId);
    if (!userGroupWorkspaceId || userGroupWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User group mapping not found in this workspace', 'user_group_mappings');
    }
  }

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
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx, userGroup.workspaceId);

    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }

    // Otherwise, verify user is MANAGER or TEAM_LEAD
    await verifyManagerOrTeamLead(this.ctx, args.userGroupId, tx, 'user_group_mappings');
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
    await this.verifyUserGroupInWorkspace(userGroupMapping.userGroupId, tx);

    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }

    // Otherwise, verify user is MANAGER or TEAM_LEAD
    await verifyManagerOrTeamLead(this.ctx, userGroupMapping.userGroupId, tx, 'user_group_mappings');
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
    await this.verifyUserGroupInWorkspace(userGroupMapping.userGroupId, tx);

    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }

    // Otherwise, verify user is MANAGER or TEAM_LEAD
    await verifyManagerOrTeamLead(this.ctx, userGroupMapping.userGroupId, tx, 'user_group_mappings');
  }
}
