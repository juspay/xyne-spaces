import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, UserRoleMappingEntityType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles, canManageUserGroup } from '../core/admin-access';
import { zql } from '../../queries';
import { getRoleInWorkspaceOrThrow } from './roles-acl';
import { getUserGroupInWorkspaceOrThrow } from './user-groups-acl';
import { getUserInWorkspaceOrThrow } from './users-acl';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class UserRoleMappingsACL extends BaseACL<'user_role_mappings'> {
  /**
   * Authorize a write against the entity the mapping belongs to, enforcing tenant isolation.
   * zql reads inside mutation ACLs are NOT workspace-scoped, so we verify every referenced
   * entity belongs to the caller's workspace (mirrors user-group-mappings-acl.ts).
   *
   * - The target user must be in the caller's workspace.
   * - WORKSPACE rows (and legacy/undefined entityType): entityId, when set, must be the
   *   caller's workspace; gated by workspace role-management permission (`assertCanManageRoles`).
   * - USER_GROUP rows: the group must be in the caller's workspace; gated by group-management
   *   permission (`canManageUserGroup(..., 'members')`).
   */
  private async authorizeByEntity(
    entityType: string | null | undefined,
    entityId: string | null | undefined,
    userId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    // The user the role is being (un)assigned to must belong to the caller's workspace.
    await getUserInWorkspaceOrThrow(userId, this.ctx.workspaceId, tx);

    if (entityType === UserRoleMappingEntityType.USER_GROUP) {
      // Throws if the group doesn't exist or is in another workspace.
      const userGroup = await getUserGroupInWorkspaceOrThrow(entityId ?? '', this.ctx.workspaceId, tx);
      const canManage = await canManageUserGroup(this.ctx, tx, userGroup, 'members');
      if (!canManage) {
        throw new MutationACLError(
          'User role mapping failed: only the creator of a group without resource grants or ADMIN access allowed',
          'user_role_mappings',
        );
      }
      return;
    }

    // WORKSPACE (and legacy/undefined default): a scoped entityId must be the caller's workspace.
    if (entityId && entityId !== this.ctx.workspaceId) {
      throw new MutationACLError('User role mapping failed: workspace scope mismatch', 'user_role_mappings');
    }
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
    await this.authorizeByEntity(mapping.entityType, mapping.entityId, mapping.userId, tx);
  }

  async canInsert(
    args: InsertValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await getRoleInWorkspaceOrThrow(args.roleId, this.ctx.workspaceId, tx);
    assertGuestWriteBlocked(this.ctx, 'user_role_mappings', 'insert', 'User role mapping');
    await this.authorizeByEntity(args.entityType, args.entityId, args.userId, tx);
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
