import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReposACL extends BaseACL<'repos'> {
  async canInsert(args: InsertValue<TableSchema<'repos'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'repos');
  }

  async canUpdate(args: UpdateValue<TableSchema<'repos'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.repos.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Repo update failed: repo does not exist', 'repos');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'repos');
  }

  async canDelete(args: DeleteID<TableSchema<'repos'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.repos.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Repo delete failed: repo does not exist', 'repos');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'repos');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'repos'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Repo upsert failed: use insert or update separately', 'repos');
  }
}
