import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles } from '../core/admin-access';
import { zql } from '../../queries';

export class RolesACL extends BaseACL<'roles'> {
  private async verifyWorkspace(roleId: string, tx: Transaction<Schema>): Promise<void> {
    const role = await tx.run(zql.roles.where('id', roleId).one());
    if (!role || role.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Role not found in this workspace', 'roles');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Role must be created in the current workspace', 'roles');
    }
    await assertCanManageRoles(this.ctx, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    await assertCanManageRoles(this.ctx, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'roles'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspace(args.id, tx);
    await assertCanManageRoles(this.ctx, tx);
  }
}
