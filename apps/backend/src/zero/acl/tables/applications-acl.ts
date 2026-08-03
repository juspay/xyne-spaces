import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ApplicationsACL extends BaseACL<'applications'> {
  async canInsert(args: InsertValue<TableSchema<'applications'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'applications');
  }

  async canUpdate(args: UpdateValue<TableSchema<'applications'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.applications.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Application update failed: application does not exist', 'applications');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'applications');
  }

  async canDelete(args: DeleteID<TableSchema<'applications'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.applications.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Application delete failed: application does not exist', 'applications');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'applications');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'applications'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Application upsert failed: use insert or update separately', 'applications');
  }
}
