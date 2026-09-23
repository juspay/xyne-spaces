import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles, canManageUserGroup } from '../core/admin-access';
import { zql } from '../../queries';
import { getRoleInWorkspaceOrThrow } from './roles-acl';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class UserRoleMappingsACL extends BaseACL<'user_role_mappings'> {
  /**
   * Authorize a write against the entity the mapping belongs to.
   *
   * - WORKSPACE rows (and legacy/undefined entityType): gated by workspace
   *   role-management permission (`assertCanManageRoles`).
   * - USER_GROUP rows: gated by group-management permission for the group
   *   identified by `entityId` (`canManageUserGroup(..., 'members')`).
   */
  private async authorizeByEntity(
    entityType: string | undefined,
    entityId: string | undefined,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (entityType === 'USER_GROUP') {
      const userGroup = await tx.run(
        zql.user_groups.where('id', entityId ?? '').one(),
      );
      if (!userGroup) {
        throw new MutationACLError('User role mapping failed: the specified group does not exist', 'user_role_mappings');
      }
      const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'members');
      if (!canManage) {
        throw new MutationACLError(
          'User role mapping failed: only the creator of a group without resource grants or ADMIN access allowed',
          'user_role_mappings',
        );
      }
      return;
    }
    // WORKSPACE (and legacy/undefined default)
    await assertCanManageRoles(this.ctx, tx);
  }

  private async verifyMapping(
    mappingId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const mapping = await tx.run(zql.user_role_mappings.where('id', mappingId).one());
    if (!mapping) {
      throw new MutationACLError('User role mapping not found', 'user_role_mappings');
    }
    await getRoleInWorkspaceOrThrow(mapping.roleId, this.ctx.workspaceId, tx);
    await this.authorizeByEntity(mapping.entityType, mapping.entityId, tx);
  }

  async canInsert(
    args: InsertValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await getRoleInWorkspaceOrThrow(args.roleId, this.ctx.workspaceId, tx);
    assertGuestWriteBlocked(this.ctx, 'user_role_mappings', 'insert', 'User role mapping');
    await this.authorizeByEntity(args.entityType, args.entityId, tx);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'user_role_mappings', 'update', 'User role mapping');
    await this.verifyMapping(args.id, tx);
  }

  async canDelete(
    args: DeleteID<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'user_role_mappings', 'delete', 'User role mapping');
    await this.verifyMapping(args.id, tx);
  }
}
