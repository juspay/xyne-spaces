import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema, UserStatus } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class TicketACl extends BaseACL<'tickets'> {

    private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
        const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
        if (!ticket) throw new MutationACLError('Ticket not found', 'tickets');
        if (ticket.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Ticket not found in this workspace', 'tickets');
        }
    }

    private async verifyGuestScope(
        tx: Transaction<Schema>,
        ticket: { workspaceId: string; channelId: string; projectId: string },
    ): Promise<void> {
        if (this.ctx.role !== 'GUEST') return;
        const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
        if (!hasAccess) {
            throw new MutationACLError('Ticket update failed: guest does not have access to this ticket', 'tickets');
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

        await this.verifyGuestScope(tx, {
            workspaceId: args.workspaceId,
            channelId: args.channelId,
            projectId: args.projectId,
        });
        if (this.ctx.role === 'GUEST') return;

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

        await this.verifyGuestScope(tx, ticket);
        if (this.ctx.role === 'GUEST') return;

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

        // Require the assignee to be an active (non-left) user. Intentionally NOT filtered by
        // users.workspaceId — that column is the user's home workspace, not a tenant boundary,
        // so a legitimate cross-workspace/guest participant would be wrongly rejected. (Being
        // assigned does not grant channel access, so an out-of-workspace assignee is a data
        // concern, not an access one.)
        if (args.assignedTo) {
            const assignee = await tx.run(
                zql.users
                    .where('id', args.assignedTo as string)
                    .where('status', UserStatus.ACTIVE)
                    .where('leftAt', 'IS', null)
                    .one()
            );
            if (!assignee) {
                throw new MutationACLError('Ticket update failed: assignee must be an active user', 'tickets');
            }
        }
    }

    async canDelete(_args: DeleteID<TableSchema<'tickets'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Ticket delete failed: tickets cannot be deleted, use status changes instead', 'tickets');
    }

    async canUpsert(_args: UpsertValue<TableSchema<'tickets'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Ticket upsert failed: use insert or update operations separately', 'tickets');
    }
}
