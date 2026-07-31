import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ImpactsACL extends BaseACL<'impacts'> {
  // Resolve ticketId -> ticket (workspace) -> channel (PUBLIC-or-participant),
  // mirroring TicketAssignmentsACL.
  private async verifyTicketAccess(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket || ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Impact failed: ticket not found in this workspace', 'impacts');
    }
    const accessible = await tx.run(
      zql.tickets
        .where('id', ticketId)
        .whereExists('channel', (channel) =>
          channel.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (participants) => participants.where('userId', this.ctx.userID))
            )
          )
        )
        .one()
    );
    if (!accessible) {
      throw new MutationACLError('Impact failed: you do not have access to the ticket\'s channel', 'impacts');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'impacts'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'impacts');
    await this.verifyTicketAccess(args.ticketId, tx);
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
