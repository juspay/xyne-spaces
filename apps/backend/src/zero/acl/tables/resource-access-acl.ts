import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, AccessType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class ResourceAccessACL extends BaseACL<'resource_access'> {
  // Helper to check if user is User Management admin (ADMIN on USER-MANAGEMENT,
  // granted directly or through any of their user groups)
  private async isUserManagementAdmin(tx: Transaction<Schema>): Promise<boolean> {
    const userManagementResource = await tx.run(
      zql.resources.where('name', 'USER-MANAGEMENT').one(),
    );
    if (!userManagementResource) {
      return false;
    }

    const directAccess = await tx.run(
      zql.resource_access
        .where('userId', this.ctx.userID)
        .where('resourceId', userManagementResource.id)
        .where('accessType', AccessType.ADMIN)
        .one(),
    );
    if (directAccess) {
      return true;
    }

    const groupMappings = await tx.run(zql.user_group_mappings.where('userId', this.ctx.userID));
    if (groupMappings.length === 0) {
      return false;
    }

    const groupAccess = await tx.run(
      zql.resource_access
        .where('groupId', 'IN', groupMappings.map(mapping => mapping.userGroupId))
        .where('resourceId', userManagementResource.id)
        .where('accessType', AccessType.ADMIN)
        .one(),
    );

    return !!groupAccess;
  }

  async canInsert(
    _args: InsertValue<TableSchema<'resource_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resource_access', 'insert', 'Resource access');

    // Only User Management admins can grant access
    const isAdmin = await this.isUserManagementAdmin(tx);
    if (!isAdmin) {
      throw new MutationACLError(
        'Only User Management admins can grant resource access',
        'resource_access',
      );
    }
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'resource_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resource_access', 'update', 'Resource access');

    // Only User Management admins can modify access
    const isAdmin = await this.isUserManagementAdmin(tx);
    if (!isAdmin) {
      throw new MutationACLError(
        'Only User Management admins can modify resource access',
        'resource_access',
      );
    }
  }

  async canDelete(
    _args: DeleteID<TableSchema<'resource_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resource_access', 'delete', 'Resource access');

    // Only User Management admins can revoke access
    const isAdmin = await this.isUserManagementAdmin(tx);
    if (!isAdmin) {
      throw new MutationACLError(
        'Only User Management admins can revoke resource access',
        'resource_access',
      );
    }
  }
}
