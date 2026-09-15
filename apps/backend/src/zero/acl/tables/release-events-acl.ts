import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReleaseEventsACL extends BaseACL<'release_events'> {
  async canInsert(args: InsertValue<TableSchema<'release_events'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'release_events');
  }

  async canUpdate(args: UpdateValue<TableSchema<'release_events'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_events.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release event update failed: event does not exist', 'release_events');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_events');
  }

  async canDelete(args: DeleteID<TableSchema<'release_events'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_events.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release event delete failed: event does not exist', 'release_events');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_events');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'release_events'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Release event upsert failed: use insert or update separately', 'release_events');
  }
}
