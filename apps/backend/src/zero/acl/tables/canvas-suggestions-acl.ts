import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CanvasSuggestionsACL extends BaseACL<'canvas_suggestions'> {
  async canInsert(args: InsertValue<TableSchema<'canvas_suggestions'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'canvas_suggestions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_suggestions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_suggestions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas suggestion update failed: row does not exist', 'canvas_suggestions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_suggestions');
  }

  async canDelete(args: DeleteID<TableSchema<'canvas_suggestions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_suggestions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas suggestion delete failed: row does not exist', 'canvas_suggestions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_suggestions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'canvas_suggestions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Canvas suggestion upsert failed: use insert or update separately', 'canvas_suggestions');
  }
}
