import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { canEditQuery } from '../core/dashboard-access';
import { zql } from '../../queries';

const TABLE = 'queries';

/** A saved query (widget) may be changed by its creator or an editor of a dashboard it is on. */
export class QueriesACL extends BaseACL<typeof TABLE> {
  private assertNewRow(args: { workspaceId?: unknown; createdBy?: unknown }) {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, TABLE);
    if (args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create a saved query for another user', TABLE);
    }
  }

  private async loadEditable(id: string, tx: Transaction<Schema>, action: string) {
    const row = await tx.run(zql.queries.where('id', id).one());
    if (!row) {
      throw new MutationACLError(`Query ${action} failed: query does not exist`, TABLE);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, TABLE);
    if (!(await canEditQuery(this.ctx, row, tx))) {
      throw new MutationACLError('You do not have permission to change this widget', TABLE);
    }
    return row;
  }

  async canInsert(args: InsertValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    this.assertNewRow(args);
  }

  async canUpdate(args: UpdateValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const row = await this.loadEditable(args.id, tx, 'update');
    if (args.createdBy !== undefined && args.createdBy !== row.createdBy) {
      throw new MutationACLError('A saved query creator cannot be changed', TABLE);
    }
  }

  async canDelete(args: DeleteID<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    await this.loadEditable(args.id, tx, 'delete');
  }

  async canUpsert(args: UpsertValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.queries.where('id', args.id).one());
    if (!existing) {
      this.assertNewRow(args);
      return;
    }
    const row = await this.loadEditable(args.id, tx, 'upsert');
    if (args.createdBy !== row.createdBy) {
      throw new MutationACLError('A saved query creator cannot be changed', TABLE);
    }
  }
}
