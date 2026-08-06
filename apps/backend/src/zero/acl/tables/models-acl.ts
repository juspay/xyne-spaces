import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ModelsACL extends BaseACL<'models'> {
  async canInsert(args: InsertValue<TableSchema<'models'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'models');
  }

  async canUpdate(args: UpdateValue<TableSchema<'models'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.models.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Model update failed: model does not exist', 'models');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'models');
  }

  async canDelete(args: DeleteID<TableSchema<'models'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.models.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Model delete failed: model does not exist', 'models');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'models');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'models'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Model upsert failed: use insert or update separately', 'models');
  }
}
