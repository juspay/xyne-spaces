import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema, WorkspaceRole } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';
import { resolveAccessibleTicket } from '../core/ticket-access';

export class SubTicketsACL extends BaseACL<'sub_tickets'> {

  /**
   * Pointing a sub-ticket at a ticket exposes its title to everyone who reads the parent.
   * Applied on insert too — linkExisting sets mappedTicketId at insert time.
   */
  private async verifyMappedTicketAccess(
    mappedTicketId: string,
    tx: Transaction<Schema>,
    operation: 'insert' | 'update',
  ): Promise<void> {
    const accessibleMapped = await resolveAccessibleTicket(mappedTicketId, this.ctx, tx);

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
    if (this.ctx.role === WorkspaceRole.GUEST) {
      await this.verifyGuestScope(args.id, tx);
      // verifyGuestScope only covers the CURRENT mapping - re-pointing needs the new target too.
      if (args.mappedTicketId) {
        await this.verifyMappedTicketAccess(args.mappedTicketId as string, tx, 'update');
      }
      return;
    }

    // subTicket.update has no existence check of its own, and a missing row must not
    // report success - one message for both cases.
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
            return channel.where(({ cmp, or, exists }) => {
              return or(
                cmp('visibility', ChannelVisibility.PUBLIC),
                exists('participants', (participants) => {
                  return participants.where('userId', this.ctx.userID);
                })
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
   * Sub-tickets cannot be deleted to close work — use a status change. The one exception is
   * `subTicket.unlink` dropping a mapping-less row that only points at an existing ticket.
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

    if (this.ctx.role === WorkspaceRole.GUEST) {
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
