import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { hasUserGroupsAdminAccess } from '../core/admin-access';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserExpertiseMappingsACL extends BaseACL<'user_expertise_mappings'> {

  async canInsert(args: InsertValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
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
      throw new MutationACLError('User expertise mapping insert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping update failed: mapping does not exist', 'user_expertise_mappings');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', mapping.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping update failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping delete failed: mapping does not exist', 'user_expertise_mappings');
    }

    // Check if user is a group member
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', mapping.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    // OR check if user has ADMIN access to USER-GROUPS resource
    const hasAdminAccess = await hasUserGroupsAdminAccess(this.ctx, tx);
    if (!membership && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping delete failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
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
      throw new MutationACLError('User expertise mapping upsert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
  }
}
