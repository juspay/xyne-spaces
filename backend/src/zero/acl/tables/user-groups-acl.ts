import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { hasUserGroupsAdminAccess, verifyManagerOrTeamLead } from '../core/admin-access';

export class UserGroupsACL extends BaseACL<'user_groups'> {

  async canInsert(_args: InsertValue<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    // Only ADMIN can create a user group
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!hasAdminAccess) {
      throw new MutationACLError('User group creation failed: only ADMIN access allowed', 'user_groups');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }

    await verifyManagerOrTeamLead(this.ctx, args.id, tx, 'user_groups');
  }

  async canDelete(_args: DeleteID<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }
    throw new MutationACLError('User group delete failed: only ADMIN access allowed', 'user_groups');
  }
}
