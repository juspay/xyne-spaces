import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserWorkloadMappingsACL extends BaseACL<'user_workload_mappings'> {

  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User workload mapping not found in this workspace', 'user_workload_mappings');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'user_workload_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
    // Only group members can track workload
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User workload mapping insert failed: you must be a group member', 'user_workload_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_workload_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_workload_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User workload mapping update failed: mapping does not exist', 'user_workload_mappings');
    }
    await this.verifyUserGroupInWorkspace(mapping.userGroupId, tx);

    // Only group members can update
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', mapping.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User workload mapping update failed: you must be a group member', 'user_workload_mappings');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
    // Only group members can upsert
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User workload mapping upsert failed: you must be a group member', 'user_workload_mappings');
    }
  }
}
