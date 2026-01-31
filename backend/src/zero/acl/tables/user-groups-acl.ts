import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema } from '../core/types';

export class UserGroupsACL extends BaseACL<'user_groups'> {

  async canInsert(_args: InsertValue<TableSchema<'user_groups'>>, _tx: Transaction<Schema>): Promise<void> {
    //Any one can create a user group
  }

  async canUpdate(_args: UpdateValue<TableSchema<'user_groups'>>, _tx: Transaction<Schema>): Promise<void> {
    // Since there is no createdBy in userGroup currently, allowing all operations for everyone
    // const existingUserGroupMapping = await tx.run(user_group_mappings.where('userGroupId', args.id).where('userId', this.ctx.userID).one().run();
    // if (!existingUserGroupMapping) {
    //   throw new MutationACLError('User group update failed: you must be a group member to modify the group', 'user_groups');
    // }
  }

  async canDelete(_args: DeleteID<TableSchema<'user_groups'>>, _tx: Transaction<Schema>): Promise<void> {
    // Since there is no createdBy in userGroup currently, allowing all operations for everyone
    // const existingUserGroupMapping = await tx.run(user_group_mappings.where('userGroupId', args.id).where('userId', this.ctx.userID).one().run();
    // if (!existingUserGroupMapping) {
    //   throw new MutationACLError('User group delete failed: you must be a group member to delete the group', 'user_groups');
    // }
  }
}
