import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { hasUserGroupsAdminAccess } from '../core/admin-access';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserAssignmentStatesACL extends BaseACL<'user_assignment_states'> {

  async canInsert(args: InsertValue<TableSchema<'user_assignment_states'>>, tx: Transaction<Schema>): Promise<void> {
    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state insert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_assignment_states'>>, tx: Transaction<Schema>): Promise<void> {
    const state = await tx.run(zql.user_assignment_states.where('id', args.id).one());
    
    if (!state) {
      throw new MutationACLError('User assignment state update failed: state does not exist', 'user_assignment_states');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', state.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state update failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state upsert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }
  }
}
