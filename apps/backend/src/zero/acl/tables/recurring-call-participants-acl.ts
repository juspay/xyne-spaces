import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class RecurringCallParticipantsACL extends BaseACL<'recurring_call_participants'> {
  async canInsert(args: InsertValue<TableSchema<'recurring_call_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'recurring_call_participants');
  }

  async canUpdate(args: UpdateValue<TableSchema<'recurring_call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recurring_call_participants.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recurring call participant update failed: participant does not exist', 'recurring_call_participants');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recurring_call_participants');
  }

  async canDelete(args: DeleteID<TableSchema<'recurring_call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recurring_call_participants.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recurring call participant delete failed: participant does not exist', 'recurring_call_participants');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recurring_call_participants');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'recurring_call_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Recurring call participant upsert failed: use insert or update separately', 'recurring_call_participants');
  }
}
