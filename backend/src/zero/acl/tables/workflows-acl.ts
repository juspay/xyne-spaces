import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class WOrkflowsAcl extends BaseACL<'workflows'> {

    private async verifyWorkspace(ticketId: string | null | undefined, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
        // If no ticketId (system workflows), allow
        if (!ticketId) return;
        const ticketWorkspaceId = workspaceId ?? await tx.run(zql.tickets.where('id', ticketId).one()).then(t => t?.workspaceId);
        if (!ticketWorkspaceId || ticketWorkspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Workflow not found in this workspace', 'workflows');
        }
    }

    async canInsert(args: InsertValue<TableSchema<'workflows'>>, tx: Transaction<Schema>): Promise<void> {
        // If no ticketId (system workflows), allow
        if (!args.ticketId) return;

        // Fetch ticket with project for workspace check and participant check
        const ticket = await tx.run(zql.tickets.where('id', args.ticketId).related('project').one());
        if (!ticket) {
            throw new MutationACLError('Workflow insert failed: the associated ticket does not exist', 'workflows');
        }

        await this.verifyWorkspace(args.ticketId, tx, ticket.workspaceId);

        if (!ticket.project) {
            throw new MutationACLError('Workflow insert failed: the associated project does not exist', 'workflows');
        }

        const isParticipant = await tx
            .run(
            zql.channels
            .where('projectId', ticket.project.id)
            .whereExists('participants', (participants) => {
                return participants.where('userId', this.ctx.userID)
            })
            .one());

        if (!isParticipant) {
            throw new MutationACLError('Workflow insert failed: you must be a project participant to create workflows', 'workflows');
        }
    }

    async canUpdate(_args: UpdateValue<TableSchema<'workflows'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow update failed: workflows are immutable once created', 'workflows');
    }

    async canDelete(_args: DeleteID<TableSchema<'workflows'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow delete failed: workflows cannot be deleted', 'workflows');
    }

    async canUpsert(_args: UpsertValue<TableSchema<'workflows'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow upsert failed: use insert operation only', 'workflows');
    }
}