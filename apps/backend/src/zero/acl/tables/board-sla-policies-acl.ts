import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class BoardSlaPoliciesACL extends BaseACL<'board_sla_policies'> {
  async canInsert(args: InsertValue<TableSchema<'board_sla_policies'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'board_sla_policies');
  }

  async canUpdate(args: UpdateValue<TableSchema<'board_sla_policies'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.board_sla_policies.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Board SLA policy update failed: policy does not exist', 'board_sla_policies');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'board_sla_policies');
  }

  async canDelete(args: DeleteID<TableSchema<'board_sla_policies'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.board_sla_policies.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Board SLA policy delete failed: policy does not exist', 'board_sla_policies');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'board_sla_policies');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'board_sla_policies'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Board SLA policy upsert failed: use insert or update separately', 'board_sla_policies');
  }
}
