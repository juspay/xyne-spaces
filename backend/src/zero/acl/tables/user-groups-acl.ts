import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { hasUserGroupsAdminAccess, verifyManagerOrTeamLead } from '../core/admin-access';
import { zql } from '../../queries';

export class UserGroupsACL extends BaseACL<'user_groups'> {

  private async verifyWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User group not found in this workspace', 'user_groups');
    }
  }

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

  async canUpdate(args: UpdateValue<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }

    await verifyManagerOrTeamLead(this.ctx, args.id, tx, 'user_groups');
  }

  async canDelete(args: DeleteID<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }
    throw new MutationACLError('User group delete failed: only ADMIN access allowed', 'user_groups');
  }
}
