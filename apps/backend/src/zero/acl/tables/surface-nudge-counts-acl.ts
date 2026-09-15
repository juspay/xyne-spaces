import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class SurfaceNudgeCountsACL extends BaseACL<'surface_nudge_counts'> {
  async canInsert(args: InsertValue<TableSchema<'surface_nudge_counts'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'surface_nudge_counts');
  }

  async canUpdate(args: UpdateValue<TableSchema<'surface_nudge_counts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.surface_nudge_counts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Surface nudge count update failed: count does not exist', 'surface_nudge_counts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'surface_nudge_counts');
  }

  async canDelete(args: DeleteID<TableSchema<'surface_nudge_counts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.surface_nudge_counts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Surface nudge count delete failed: count does not exist', 'surface_nudge_counts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'surface_nudge_counts');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'surface_nudge_counts'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Surface nudge count upsert failed: use insert or update separately', 'surface_nudge_counts');
  }
}
