import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { hasUserGroupsAdminAccess } from '../core/admin-access';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class BoardComplexityScoresACL extends BaseACL<'board_complexity_scores'> {

  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Board complexity score not found in this workspace', 'board_complexity_scores');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'board_complexity_scores'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
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
      throw new MutationACLError('Board complexity score insert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'board_complexity_scores');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'board_complexity_scores'>>, tx: Transaction<Schema>): Promise<void> {
    const score = await tx.run(zql.board_complexity_scores.where('id', args.id).one());
    
    if (!score) {
      throw new MutationACLError('Board complexity score update failed: score does not exist', 'board_complexity_scores');
    }
    await this.verifyUserGroupInWorkspace(score.userGroupId, tx);

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', score.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('Board complexity score update failed: you must be a group member or have ADMIN access to USER-GROUPS', 'board_complexity_scores');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
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
      throw new MutationACLError('Board complexity score upsert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'board_complexity_scores');
    }
  }
}
