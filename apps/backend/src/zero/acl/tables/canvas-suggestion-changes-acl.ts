import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CanvasSuggestionChangesACL extends BaseACL<'canvas_suggestion_changes'> {
  async canInsert(args: InsertValue<TableSchema<'canvas_suggestion_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'canvas_suggestion_changes');
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_suggestion_changes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_suggestion_changes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas suggestion change update failed: row does not exist', 'canvas_suggestion_changes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_suggestion_changes');
  }

  async canDelete(args: DeleteID<TableSchema<'canvas_suggestion_changes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_suggestion_changes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas suggestion change delete failed: row does not exist', 'canvas_suggestion_changes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_suggestion_changes');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'canvas_suggestion_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Canvas suggestion change upsert failed: use insert or update separately', 'canvas_suggestion_changes');
  }
}
