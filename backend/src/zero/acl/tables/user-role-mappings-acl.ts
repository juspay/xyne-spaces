import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles } from '../core/admin-access';
import { zql } from '../../queries';

export class UserRoleMappingsACL extends BaseACL<'user_role_mappings'> {
  private async verifyWorkspace(
    mappingId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const mapping = await tx.run(zql.user_role_mappings.where('id', mappingId).one());
    if (!mapping) {
      throw new MutationACLError('User role mapping not found', 'user_role_mappings');
    }
    const role = await tx.run(zql.roles.where('id', mapping.roleId).one());
    if (!role || role.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Role not found in this workspace', 'user_role_mappings');
    }
  }

  private async verifyRoleInWorkspace(
    roleId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const role = await tx.run(zql.roles.where('id', roleId).one());
    if (!role || role.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Role not found in this workspace', 'user_role_mappings');
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.verifyRoleInWorkspace(args.roleId, tx);
    await assertCanManageRoles(this.ctx, tx);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    await assertCanManageRoles(this.ctx, tx);
  }

  async canDelete(
    args: DeleteID<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    await assertCanManageRoles(this.ctx, tx);
  }
}
