import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CoesACL extends BaseACL<'coes'> {
  async canInsert(args: InsertValue<TableSchema<'coes'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'coes');
  }

  async canUpdate(args: UpdateValue<TableSchema<'coes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.coes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('COE update failed: COE does not exist', 'coes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'coes');
  }

  async canDelete(args: DeleteID<TableSchema<'coes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.coes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('COE delete failed: COE does not exist', 'coes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'coes');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'coes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('COE upsert failed: use insert or update separately', 'coes');
  }
}
