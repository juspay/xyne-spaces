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

  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User assignment state not found in this workspace', 'user_assignment_states');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'user_assignment_states'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);

    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);

    // Prevent forging another member's assignment state (e.g. flipping a
    // colleague on/off-call): a row targeting a different userId is only
    // allowed for USER-GROUPS admins.
    if (args.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User assignment state insert failed: you can only modify your own assignment state unless you have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );

    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state insert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }

    // The target user must actually belong to the group being written to.
    const targetMembership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', args.userId)
        .one()
    );
    if (!targetMembership) {
      throw new MutationACLError('User assignment state insert failed: target user is not a member of this user group', 'user_assignment_states');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_assignment_states'>>, tx: Transaction<Schema>): Promise<void> {
    const state = await tx.run(zql.user_assignment_states.where('id', args.id).one());
    
    if (!state) {
      throw new MutationACLError('User assignment state update failed: state does not exist', 'user_assignment_states');
    }
    await this.verifyUserGroupInWorkspace(state.userGroupId, tx);

    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);

    // Only the owner of the assignment state (or a USER-GROUPS admin) may edit it.
    if (state.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User assignment state update failed: you can only modify your own assignment state unless you have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }

    // Disallow re-pointing the row to a different user unless admin.
    if (args.userId !== undefined && args.userId !== state.userId && !hasAdminAccess) {
      throw new MutationACLError('User assignment state update failed: you cannot reassign this state to another user', 'user_assignment_states');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', state.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );

    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state update failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);

    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);

    // Prevent forging another member's assignment state via upsert: a row
    // targeting a different userId is only allowed for USER-GROUPS admins.
    if (args.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User assignment state upsert failed: you can only modify your own assignment state unless you have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );

    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User assignment state upsert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_assignment_states');
    }

    // The target user must actually belong to the group being written to.
    const targetMembership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', args.userId)
        .one()
    );
    if (!targetMembership) {
      throw new MutationACLError('User assignment state upsert failed: target user is not a member of this user group', 'user_assignment_states');
    }
  }
}
