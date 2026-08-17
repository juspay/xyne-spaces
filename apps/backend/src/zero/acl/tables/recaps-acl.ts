import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class RecapsACL extends BaseACL<'recaps'> {
  async canInsert(args: InsertValue<TableSchema<'recaps'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'recaps');
  }

  async canUpdate(args: UpdateValue<TableSchema<'recaps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recaps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recap update failed: recap does not exist', 'recaps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recaps');
  }

  async canDelete(args: DeleteID<TableSchema<'recaps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recaps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recap delete failed: recap does not exist', 'recaps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recaps');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'recaps'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Recap upsert failed: use insert or update separately', 'recaps');
  }
}
