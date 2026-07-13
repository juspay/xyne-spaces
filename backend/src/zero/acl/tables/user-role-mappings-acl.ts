import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema, MutationACLError } from '../core/types';
import { assertCanManageRoles } from '../core/admin-access';
import { zql } from '../../queries';
import { getRoleInWorkspaceOrThrow } from './roles-acl';

export class UserRoleMappingsACL extends BaseACL<'user_role_mappings'> {
  private async verifyWorkspace(
    mappingId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const mapping = await tx.run(zql.user_role_mappings.where('id', mappingId).one());
    if (!mapping) {
      throw new MutationACLError('User role mapping not found', 'user_role_mappings');
    }
    await getRoleInWorkspaceOrThrow(mapping.roleId, this.ctx.workspaceId, tx);
  }

  async canInsert(
    args: InsertValue<TableSchema<'user_role_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await getRoleInWorkspaceOrThrow(args.roleId, this.ctx.workspaceId, tx);
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
