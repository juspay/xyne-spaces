import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, UserResponsibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class UserGroupMappingsACL extends BaseACL<'user_group_mappings'> {

  private async verifyManagerOrTeamLead(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    // Check if the requester is a MANAGER or TEAM_LEAD in this group
    const requesterMapping = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
      
    if (!requesterMapping) {
      throw new MutationACLError('User group mapping operation failed: you must be a member of the group', 'user_group_mappings');
    }

    if (requesterMapping.responsibility !== UserResponsibility.MANAGER && 
        requesterMapping.responsibility !== UserResponsibility.TEAM_LEAD) {
      throw new MutationACLError('User group mapping operation failed: only MANAGER or TEAM_LEAD can perform this operation', 'user_group_mappings');
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
    
    await this.verifyManagerOrTeamLead(args.userGroupId, tx);
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

    await this.verifyManagerOrTeamLead(userGroupMapping.userGroupId, tx);
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

    await this.verifyManagerOrTeamLead(userGroupMapping.userGroupId, tx);
  }
}
