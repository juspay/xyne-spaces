import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, type Role } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles } from '../core/admin-access';
import { zql } from '../../queries';

export async function getRoleInWorkspaceOrThrow(
  roleId: string,
  workspaceId: string,
  tx: Transaction<Schema>
): Promise<Role> {
  const role = await tx.run(zql.roles.where('id', roleId).one());
  if (!role || role.workspaceId !== workspaceId) {
    throw new MutationACLError('Role not found in this workspace', 'roles');
  }
  return role;
}

export class RolesACL extends BaseACL<'roles'> {
  async canInsert(args: InsertValue<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Role must be created in the current workspace', 'roles');
    }
    await assertCanManageRoles(this.ctx, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    await getRoleInWorkspaceOrThrow(args.id, this.ctx.workspaceId, tx);
    await assertCanManageRoles(this.ctx, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    await getRoleInWorkspaceOrThrow(args.id, this.ctx.workspaceId, tx);
    await assertCanManageRoles(this.ctx, tx);
  }
}
