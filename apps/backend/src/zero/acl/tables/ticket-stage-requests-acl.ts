import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class TicketStageRequestsACL extends BaseACL<'ticket_stage_requests'> {
  async canInsert(args: InsertValue<TableSchema<'ticket_stage_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'ticket_stage_requests');
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_stage_requests'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_stage_requests.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket stage request update failed: request does not exist', 'ticket_stage_requests');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_stage_requests');
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_stage_requests'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_stage_requests.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket stage request delete failed: request does not exist', 'ticket_stage_requests');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_stage_requests');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_stage_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    // TEMPORARY (workspaceId-non-optional PR): allow upsert without a per-table
    // tenant check so live callers don't break. The row's workspaceId is stamped
    // from trusted authData in the mutators, not client args. A proper canUpsert
    // (delegate to canInsert/canUpdate by row existence) lands in a follow-up PR.
    return;
  }
}
