import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';
import { accessibleTicketQuery } from '../core/ticket-access';

export class SubTicketsACL extends BaseACL<'sub_tickets'> {

  /**
   * Pointing a sub-ticket at a ticket exposes that ticket's title/xyneId to everyone
   * who can read the parent, so the caller must be able to see it. Applied on BOTH
   * insert and update: `subTicket.linkExisting` sets mappedTicketId at insert time,
   * which used to skip the check that only canUpdate performed.
   */
  private async verifyMappedTicketAccess(
    mappedTicketId: string,
    tx: Transaction<Schema>,
    operation: 'insert' | 'update',
  ): Promise<void> {
    const accessibleMapped = await tx.run(
      accessibleTicketQuery(mappedTicketId, {
        sub: this.ctx.userID,
        workspaceId: this.ctx.workspaceId,
      }).one(),
    );

    if (!accessibleMapped) {
      throw new MutationACLError(
        `Sub-ticket ${operation} failed: you do not have access to the target mapped ticket's channel`,
        'sub_tickets',
      );
    }
  }

  async canInsert(args: InsertValue<TableSchema<'sub_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not in this workspace', 'sub_tickets');
    }
    if (args.mappedTicketId) {
      await this.verifyMappedTicketAccess(args.mappedTicketId as string, tx, 'insert');
    }
  }

  private async verifyGuestScope(subTicketId: string, tx: Transaction<Schema>): Promise<void> {
    const subTicket = await tx.run(zql.sub_tickets.where('id', subTicketId).related('mappedTicket').one());
    if (!subTicket) {
      throw new MutationACLError('Sub-ticket not found', 'sub_tickets');
    }
    const ticket = subTicket.mappedTicket;
    if (!ticket || ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }
    const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
    if (!hasAccess) {
      throw new MutationACLError('Sub-ticket not accessible for guest users', 'sub_tickets');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'sub_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      await this.verifyGuestScope(args.id, tx);
      return;
    }

    // Get existing subTicket to verify workspace
    const subTicket = await tx.run(zql.sub_tickets.where('id', args.id).one());
    if (!subTicket || subTicket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }

    // When mappedTicketId is being changed, verify the caller can access the new
    // target's channel and that it is in the same workspace.
    if (args.mappedTicketId) {
      await this.verifyMappedTicketAccess(args.mappedTicketId as string, tx, 'update');
    }

    if (!subTicket.mappedTicketId) {
      return;
    }

    const mappedTicket = await tx.run(zql.sub_tickets
      .where('id', args.id)
      .whereExists('mappedTicket', (ticket) => {
        return ticket.whereExists('conversation', (conversation) => {
          return conversation.whereExists('channel', (channel) => {
            return channel.where(({ cmp, or, exists, and }) => {
              return or(
                and(
                  cmp('visibility', ChannelVisibility.PRIVATE),
                  exists('participants', (participants) => {
                    return participants.where('userId', this.ctx.userID);
                  })
                ),
                and(
                  cmp('visibility', ChannelVisibility.PUBLIC),
                  exists('project', (project) => {
                    return project.whereExists('channels', (channelQuery) => {
                      return channelQuery
                        .where('visibility', ChannelVisibility.PUBLIC)
                        .whereExists('participants', (participants) => {
                          return participants.where('userId', this.ctx.userID);
                        });
                    });
                  })
                )
              );
            });
          });
        });
      })
      .one());

    if (!mappedTicket) {
      throw new MutationACLError('Sub-ticket update failed: you do not have access to the sub-ticket channel', 'sub_tickets');
    }
  }

  /**
   * Sub-tickets still cannot be deleted as a way of closing work — that is what the
   * status change is for, and a drafted sub-ticket (mappedTicketId === null) holds
   * the only copy of its own title/description.
   *
   * The one exception is `subTicket.unlink` tidying up after itself: a row that
   * merely POINTS at an existing ticket and no longer has any parent mapping is pure
   * linkage carrying no content, and leaving it behind would keep the unlinked
   * ticket looking like somebody's sub-ticket forever
   * (queries.subTicketsByMappedTicketId). Deleting it destroys nothing — the ticket
   * it pointed at is untouched.
   */
  async canDelete(args: DeleteID<TableSchema<'sub_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    const subTicket = await tx.run(zql.sub_tickets.where('id', args.id).one());
    if (!subTicket || subTicket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }

    if (!subTicket.mappedTicketId) {
      throw new MutationACLError(
        'Sub-ticket delete failed: sub-tickets cannot be deleted, use status changes instead',
        'sub_tickets',
      );
    }

    const remainingMappings = await tx.run(
      zql.ticket_sub_ticket_mappings.where('subTicketId', args.id),
    );
    if (remainingMappings.length > 0) {
      throw new MutationACLError(
        'Sub-ticket delete failed: unlink it from its parent ticket first',
        'sub_tickets',
      );
    }

    if (this.ctx.role === 'GUEST') {
      const mappedTicket = await tx.run(
        zql.tickets.where('id', subTicket.mappedTicketId).one(),
      );
      if (!mappedTicket || !(await hasGuestTicketAccess(this.ctx, tx, mappedTicket))) {
        throw new MutationACLError('Sub-ticket not accessible for guest users', 'sub_tickets');
      }
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Sub-ticket upsert failed: use insert or update operations separately', 'sub_tickets');
  }
}
