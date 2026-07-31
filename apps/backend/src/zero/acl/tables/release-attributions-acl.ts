import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReleaseAttributionsACL extends BaseACL<'release_attributions'> {
  async canInsert(args: InsertValue<TableSchema<'release_attributions'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'release_attributions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'release_attributions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_attributions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release attribution update failed: attribution does not exist', 'release_attributions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_attributions');
  }

  async canDelete(args: DeleteID<TableSchema<'release_attributions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_attributions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release attribution delete failed: attribution does not exist', 'release_attributions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_attributions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'release_attributions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Release attribution upsert failed: use insert or update separately', 'release_attributions');
  }
}
