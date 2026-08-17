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

  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User expertise mapping not found in this workspace', 'user_expertise_mappings');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
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
      throw new MutationACLError('User expertise mapping insert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }

    // Expertise drives assignment routing, so a row targeting another member is only
    // allowed for USER-GROUPS admins — otherwise any group member could redirect work
    // by writing a colleague's expertise.
    if (args.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping insert failed: you can only modify your own expertise unless you have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping update failed: mapping does not exist', 'user_expertise_mappings');
    }
    await this.verifyUserGroupInWorkspace(mapping.userGroupId, tx);

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

    // Only the owning member (or a USER-GROUPS admin) may change an expertise row, and the
    // row's owner cannot be reassigned to someone else.
    if (mapping.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping update failed: you can only modify your own expertise unless you have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
    if (args.userId !== undefined && args.userId !== mapping.userId && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping update failed: cannot reassign the mapping to another user', 'user_expertise_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping delete failed: mapping does not exist', 'user_expertise_mappings');
    }
    await this.verifyUserGroupInWorkspace(mapping.userGroupId, tx);

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

    if (mapping.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping delete failed: you can only remove your own expertise unless you have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
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
      throw new MutationACLError('User expertise mapping upsert failed: you must be a group member or have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }

    // Upsert reaches the same row as insert/update, so it carries the same restriction:
    // a row targeting another member requires USER-GROUPS admin, and an existing row's
    // owner cannot be taken over.
    if (args.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping upsert failed: you can only modify your own expertise unless you have ADMIN access to USER-GROUPS', 'user_expertise_mappings');
    }
    const existing = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    if (existing && existing.userId !== this.ctx.userID && !hasAdminAccess) {
      throw new MutationACLError('User expertise mapping upsert failed: cannot modify another user\'s expertise', 'user_expertise_mappings');
    }
  }
}
