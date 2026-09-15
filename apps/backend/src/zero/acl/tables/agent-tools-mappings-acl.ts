import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class AgentToolsMappingsACL extends BaseACL<'agent_tools_mappings'> {
  async canInsert(args: InsertValue<TableSchema<'agent_tools_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'agent_tools_mappings');
  }

  async canUpdate(args: UpdateValue<TableSchema<'agent_tools_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.agent_tools_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Agent tools mapping update failed: mapping does not exist', 'agent_tools_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'agent_tools_mappings');
  }

  async canDelete(args: DeleteID<TableSchema<'agent_tools_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.agent_tools_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Agent tools mapping delete failed: mapping does not exist', 'agent_tools_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'agent_tools_mappings');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'agent_tools_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Agent tools mapping upsert failed: use insert or update separately', 'agent_tools_mappings');
  }
}
