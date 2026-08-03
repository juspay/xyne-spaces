import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class AgentsACL extends BaseACL<'agents'> {
  async canInsert(args: InsertValue<TableSchema<'agents'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'agents');
  }

  async canUpdate(args: UpdateValue<TableSchema<'agents'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.agents.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Agent update failed: agent does not exist', 'agents');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'agents');
  }

  async canDelete(args: DeleteID<TableSchema<'agents'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.agents.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Agent delete failed: agent does not exist', 'agents');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'agents');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'agents'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Agent upsert failed: use insert or update separately', 'agents');
  }
}
