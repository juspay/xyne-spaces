import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, AccessType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';
import { getUserInWorkspaceOrThrow } from './users-acl';

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

  // Zero writes bypass the Prisma tenant filter, so scope to the workspace here.
  private async assertGrantInWorkspace(id: string, tx: Transaction<Schema>): Promise<void> {
    const grant = await tx.run(zql.resource_access.where('id', id).one());
    if (!grant || grant.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Resource access not found in this workspace', 'resource_access');
    }
  }

  private async assertGranteeInWorkspace(
    args: InsertValue<TableSchema<'resource_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Resource access must be granted in your own workspace', 'resource_access');
    }

    if (args.userId) {
      await getUserInWorkspaceOrThrow(args.userId, this.ctx.workspaceId, tx);
    }

    if (args.groupId) {
      const group = await tx.run(zql.user_groups.where('id', args.groupId).one());
      if (!group || group.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('User group not found in this workspace', 'resource_access');
      }
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'resource_access'>>,
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

    await this.assertGranteeInWorkspace(args, tx);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'resource_access'>>,
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

    await this.assertGrantInWorkspace(args.id, tx);
  }

  async canDelete(
    args: DeleteID<TableSchema<'resource_access'>>,
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

    await this.assertGrantInWorkspace(args.id, tx);
  }
}
