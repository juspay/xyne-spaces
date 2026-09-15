import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class DashboardQueriesMappingACL extends BaseACL<'dashboard_queries_mapping'> {
  async canInsert(args: InsertValue<TableSchema<'dashboard_queries_mapping'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'dashboard_queries_mapping');
  }

  async canUpdate(args: UpdateValue<TableSchema<'dashboard_queries_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard queries mapping update failed: mapping does not exist', 'dashboard_queries_mapping');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'dashboard_queries_mapping');
  }

  async canDelete(args: DeleteID<TableSchema<'dashboard_queries_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard queries mapping delete failed: mapping does not exist', 'dashboard_queries_mapping');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'dashboard_queries_mapping');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'dashboard_queries_mapping'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Dashboard queries mapping upsert failed: use insert or update separately', 'dashboard_queries_mapping');
  }
}
