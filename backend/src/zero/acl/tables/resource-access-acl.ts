import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, AccessType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ResourceAccessACL extends BaseACL<'resource_access'> {
  // Helper to check if user is User Management admin (ADMIN on USERS resource)
  private async isUserManagementAdmin(tx: Transaction<Schema>): Promise<boolean> {
    const usersResource = await tx.run(zql.resources.where('name', 'USERS').one());
    if (!usersResource) {
      return false;
    }

    const adminAccess = await tx.run(
      zql.resource_access
        .where('userId', this.ctx.userID)
        .where('resourceId', usersResource.id)
        .where('accessType', AccessType.ADMIN)
        .one(),
    );

    return !!adminAccess;
  }

  async canInsert(
    _args: InsertValue<TableSchema<'resource_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
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
