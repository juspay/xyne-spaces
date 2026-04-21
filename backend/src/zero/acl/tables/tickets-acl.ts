import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketACl extends BaseACL<'tickets'> {

    private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
        const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
        if (!ticket) throw new MutationACLError('Ticket not found', 'tickets');
        if (ticket.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Ticket not found in this workspace', 'tickets');
        }
    }

    async canInsert(args: InsertValue<TableSchema<'tickets'>>, tx: Transaction<Schema>): Promise<void> {
        if (args.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Ticket not found in this workspace', 'tickets');
        }

        const channel = await tx.run(zql.channels.where('id', args.channelId).one());
        if (channel?.isArchived) {
            throw new MutationACLError('Ticket insert failed: cannot create tickets in archived channel', 'tickets');
        }
        const isParticipant = await tx
            .run(
            zql.channels
            .where('projectId', args.projectId)
            .whereExists('participants', (participants) => {
                return participants.where('userId', this.ctx.userID)
            })
            .one());

        if (!isParticipant) {
            throw new MutationACLError('Ticket insert failed: you must be a project participant to create tickets', 'tickets');
        }

    }

    async canUpdate(args: UpdateValue<TableSchema<'tickets'>>, tx: Transaction<Schema>): Promise<void> {
        const ticket = await tx.run(zql.tickets.where('id', args.id).one());
        if (!ticket) {
            throw new MutationACLError('Ticket update failed: ticket does not exist', 'tickets');
        }
        await this.verifyTicketInWorkspace(ticket.id, tx);

        if (ticket.isArchived && args.isArchived === false) {
            throw new MutationACLError('Ticket update failed: cannot unarchive ticket - archival is permanent', 'tickets');
        }

        if (ticket.isArchived) {
            throw new MutationACLError('Ticket update failed: cannot update archived ticket', 'tickets');
        }

        const isParticipant = await tx
            .run(
            zql.channels
            .where('projectId', ticket.projectId)
            .whereExists('participants', (participants) => {
                return participants.where('userId', this.ctx.userID)
            })
            .one());

        if (!isParticipant) {
            throw new MutationACLError('Ticket update failed: you must be a project participant to update tickets', 'tickets');
        }
    }

    async canDelete(_args: DeleteID<TableSchema<'tickets'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Ticket delete failed: tickets cannot be deleted, use status changes instead', 'tickets');
    }

    async canUpsert(_args: UpsertValue<TableSchema<'tickets'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Ticket upsert failed: use insert or update operations separately', 'tickets');
    }
}