import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ToolsACL extends BaseACL<'tools'> {
  async canInsert(args: InsertValue<TableSchema<'tools'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'tools');
  }

  async canUpdate(args: UpdateValue<TableSchema<'tools'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.tools.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Tool update failed: tool does not exist', 'tools');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'tools');
  }

  async canDelete(args: DeleteID<TableSchema<'tools'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.tools.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Tool delete failed: tool does not exist', 'tools');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'tools');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'tools'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Tool upsert failed: use insert or update separately', 'tools');
  }
}
