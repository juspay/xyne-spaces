import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class TicketTagMappingsACL extends BaseACL<'ticket_tag_mappings'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket tag mapping not found: ticket does not exist', 'ticket_tag_mappings');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket tag mapping not found in this workspace', 'ticket_tag_mappings');
    }
  }

  private async verifyGuestScope(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) {
      throw new MutationACLError('Ticket tag mapping failed: ticket does not exist', 'ticket_tag_mappings');
    }
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket tag mapping failed: not in this workspace', 'ticket_tag_mappings');
    }
    const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
    if (!hasAccess) {
      throw new MutationACLError('Ticket tag mapping failed: guest does not have access to this ticket', 'ticket_tag_mappings');
    }
  }

  private async resolveTicketIdFromMapping(mappingId: string, tx: Transaction<Schema>): Promise<string> {
    const mapping = await tx.run(zql.ticket_tag_mappings.where('id', mappingId).one());
    if (!mapping) {
      throw new MutationACLError('Ticket tag mapping failed: mapping does not exist', 'ticket_tag_mappings');
    }
    return mapping.ticketId;
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_tag_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      await this.verifyGuestScope(args.ticketId, tx);
      return;
    }
    await this.verifyTicketInWorkspace(args.ticketId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_tag_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const ticketId = await this.resolveTicketIdFromMapping(args.id, tx);
      await this.verifyGuestScope(ticketId, tx);
      return;
    }
    const mapping = await tx.run(zql.ticket_tag_mappings.where('id', args.id).one());
    if (mapping) {
      await this.verifyTicketInWorkspace(mapping.ticketId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_tag_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const ticketId = await this.resolveTicketIdFromMapping(args.id, tx);
      await this.verifyGuestScope(ticketId, tx);
      return;
    }
    const mapping = await tx.run(zql.ticket_tag_mappings.where('id', args.id).one());
    if (mapping) {
      await this.verifyTicketInWorkspace(mapping.ticketId, tx);
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_tag_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket tag mapping upsert failed: use insert or update operations separately', 'ticket_tag_mappings');
  }
}
