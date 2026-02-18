import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema } from '../core/types';
import { hasUserGroupsAdminAccess } from '../core/admin-access';

export class UserGroupsACL extends BaseACL<'user_groups'> {

  async canInsert(_args: InsertValue<TableSchema<'user_groups'>>, _tx: Transaction<Schema>): Promise<void> {
    //Any one can create a user group
  }

  async canUpdate(_args: UpdateValue<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'user_groups'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (hasAdminAccess) {
      return;
    }
  }
}
