import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class RcasACL extends BaseACL<'rcas'> {
  async canInsert(args: InsertValue<TableSchema<'rcas'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'rcas');
  }

  async canUpdate(args: UpdateValue<TableSchema<'rcas'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.rcas.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('RCA update failed: RCA does not exist', 'rcas');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'rcas');
  }

  async canDelete(args: DeleteID<TableSchema<'rcas'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.rcas.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('RCA delete failed: RCA does not exist', 'rcas');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'rcas');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'rcas'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('RCA upsert failed: use insert or update separately', 'rcas');
  }
}
