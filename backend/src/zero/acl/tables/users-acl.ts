import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, WorkspaceRole } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class UsersACL extends BaseACL<'users'> {

  private async verifyLastAdmin(workspaceId: string, tx: Transaction<Schema>, errorMessage: string): Promise<void> {
    const adminCount = await tx.run(
      zql.users
        .where('workspaceId', workspaceId)
        .where('role', WorkspaceRole.ADMIN)
        .where('leftAt', 'IS', null)
    );
    const ownerCount = await tx.run(
      zql.users
        .where('workspaceId', workspaceId)
        .where('role', WorkspaceRole.OWNER)
        .where('leftAt', 'IS', null)
    );
    const totalAdmins = adminCount.length + ownerCount.length;
    if (totalAdmins <= 1) {
      throw new MutationACLError(errorMessage, 'users');
    }
  }

  async canInsert(_args: InsertValue<TableSchema<'users'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User insert failed: users are created through authentication and cannot be inserted directly', 'users');
  }

  async canUpdate(args: UpdateValue<TableSchema<'users'>>, tx: Transaction<Schema>): Promise<void> {
    // User can update their own profile, but cannot change their own role
    if (args.id === this.ctx.userID) {
      if (args.role !== undefined) {
        throw new MutationACLError('User update failed: you cannot change your own role', 'users');
      }
      return;
    }

    // Admin/Owner updating another user's role or leftAt (removal)
    if ((args.role !== undefined || args.leftAt !== undefined) && args.id !== this.ctx.userID) {
      const currentUser = await tx.run(zql.users.where('id', this.ctx.userID).one());

      if (!currentUser || (currentUser.role !== WorkspaceRole.ADMIN && currentUser.role !== WorkspaceRole.OWNER)) {
        throw new MutationACLError('User update failed: only workspace admins can change user roles', 'users');
      }

      const targetUser = await tx.run(zql.users.where('id', args.id).one());

      if (!targetUser || targetUser.workspaceId !== currentUser.workspaceId) {
        throw new MutationACLError('User update failed: cannot modify users in different workspaces', 'users');
      }

      if (!targetUser.workspaceId) {
        throw new MutationACLError('User update failed: target user has no workspace', 'users');
      }

      const targetWorkspaceId = targetUser.workspaceId;

      // Check "last admin" constraint for role changes
      if (args.role !== undefined && args.role !== WorkspaceRole.ADMIN && args.role !== WorkspaceRole.OWNER) {
        if (targetUser.role === WorkspaceRole.ADMIN || targetUser.role === WorkspaceRole.OWNER) {
          await this.verifyLastAdmin(targetWorkspaceId, tx, 'User update failed: cannot demote the only admin');
        }
      }

      // Check "last admin" constraint for removal (leftAt)
      if (args.leftAt !== undefined && args.leftAt !== null) {
        if (targetUser.role === WorkspaceRole.ADMIN || targetUser.role === WorkspaceRole.OWNER) {
          await this.verifyLastAdmin(targetWorkspaceId, tx, 'User update failed: cannot remove the only admin');
        }
      }

      return;
    }

    throw new MutationACLError('User update failed: you can only modify your own profile', 'users');
  }

  async canDelete(_args: DeleteID<TableSchema<'users'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User delete failed: users cannot be deleted directly, use account deactivation instead', 'users');
  }
}
