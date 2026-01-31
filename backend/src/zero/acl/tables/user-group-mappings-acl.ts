import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema } from '../core/types';

export class UserGroupMappingsACL extends BaseACL<'user_group_mappings'> {

  async canInsert(_args: InsertValue<TableSchema<'user_group_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    // Since there is no createdBy in userGroup currently, allowing all operations for everyone
    // const userGroup = await tx
    //   .query
    //   .user_groups
    //   .where('id', args.userGroupId)
    //   .one()
    //   .run();
      
    // if (!userGroup) {
    //   throw new MutationACLError('User group mapping insert failed: the specified group does not exist', 'user_group_mappings');
    // }
    
    // const isRequesterMember = await tx
    //   .query
    //   .user_group_mappings
    //   .where('userGroupId', args.userGroupId)
    //   .where('userId', this.ctx.userID)
    //   .one()
    //   .run();
      
    // if (!isRequesterMember) {
    //   throw new MutationACLError('User group mapping insert failed: you must be a group member to add others', 'user_group_mappings');
    // }
   }

  async canUpdate(_args: UpdateValue<TableSchema<'user_group_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    // Since there is no createdBy in userGroup currently, allowing all operations for everyone
    // const user_group_mapping = await tx
    //   .query
    //   .user_group_mappings
    //   .where('id', args.id)
    //   .related('userGroup')
    //   .one()
    //   .run();
      
    // if (!user_group_mapping) {
    //   throw new MutationACLError('User group mapping update failed: the mapping does not exist', 'user_group_mappings');
    // }
    // if (user_group_mapping.userId !== this.ctx.userID ) {
    //   throw new MutationACLError('User group mapping update failed: you can only modify mappings for groups you are a member of', 'user_group_mappings');
    // }
  }

  async canDelete(_args: DeleteID<TableSchema<'user_group_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    // Since there is no createdBy in userGroup currently, allowing all operations for everyone
    // const user_group_mapping = await tx
    //   .query
    //   .user_group_mappings
    //   .where('id', args.id)
    //   .one()
    //   .run();
      
    // if (!user_group_mapping ) {
    //   throw new MutationACLError('User group mapping delete failed: the mapping does not exist', 'user_group_mappings');
    // }
    // if (user_group_mapping.userId !== this.ctx.userID) {
    //   throw new MutationACLError('User group mapping delete failed: you can only remove mappings for groups you are a member of', 'user_group_mappings');
    // }
  }
}
