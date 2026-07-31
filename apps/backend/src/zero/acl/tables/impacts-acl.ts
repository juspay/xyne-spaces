import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ImpactsACL extends BaseACL<'impacts'> {
  async canInsert(args: InsertValue<TableSchema<'impacts'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'impacts');
  }

  async canUpdate(args: UpdateValue<TableSchema<'impacts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.impacts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Impact update failed: impact does not exist', 'impacts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'impacts');
  }

  async canDelete(args: DeleteID<TableSchema<'impacts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.impacts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Impact delete failed: impact does not exist', 'impacts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'impacts');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'impacts'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Impact upsert failed: use insert or update separately', 'impacts');
  }
}
