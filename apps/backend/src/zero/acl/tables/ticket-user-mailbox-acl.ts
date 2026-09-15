import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class TicketUserMailboxACL extends BaseACL<'ticket_user_mailbox'> {
  async canInsert(args: InsertValue<TableSchema<'ticket_user_mailbox'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'ticket_user_mailbox');
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_user_mailbox'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_user_mailbox.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket user mailbox update failed: mailbox does not exist', 'ticket_user_mailbox');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_user_mailbox');
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_user_mailbox'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_user_mailbox.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket user mailbox delete failed: mailbox does not exist', 'ticket_user_mailbox');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_user_mailbox');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_user_mailbox'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket user mailbox upsert failed: use insert or update separately', 'ticket_user_mailbox');
  }
}
