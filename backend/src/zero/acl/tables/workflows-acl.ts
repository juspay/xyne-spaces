import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class WOrkflowsAcl extends BaseACL<'workflows'> {

    async canInsert(args: InsertValue<TableSchema<'workflows'>>, tx: Transaction<Schema>): Promise<void> {
        const ticket = await tx.run(zql.tickets.where('id', args.ticketId).one());
        if (!ticket) {
            throw new MutationACLError('Workflow insert failed: the associated ticket does not exist', 'workflows');
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