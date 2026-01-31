import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class WorkflowExecutionsAcl extends BaseACL<'workflow_executions'> {

    async canInsert(args: InsertValue<TableSchema<'workflow_executions'>>, tx: Transaction<Schema>): Promise<void> {
        const workflow = await tx.run(zql.workflows.where('id', args.workflowId).related('ticket').one());
        if (!workflow || !workflow.ticket) {
            throw new MutationACLError('Workflow execution insert failed: the specified workflow or its ticket does not exist', 'workflow_executions');
        }
        const isParticipant = await tx
            .run(
            zql.channels
            .where('projectId', workflow.ticket.projectId)
            .whereExists('participants', (participants) => {
                return participants.where('userId', this.ctx.userID)
            })
            .one());

        if (!isParticipant) {
            throw new MutationACLError('Workflow execution insert failed: you must be a project participant to execute workflows', 'workflow_executions');
        }
    }

    async canUpdate(_args: UpdateValue<TableSchema<'workflow_executions'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow execution update failed: executions are immutable once created', 'workflow_executions');
    }

    async canDelete(_args: DeleteID<TableSchema<'workflow_executions'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow execution delete failed: executions cannot be deleted', 'workflow_executions');
    }

    async canUpsert(_args: UpsertValue<TableSchema<'workflow_executions'>>, _tx: Transaction<Schema>): Promise<void> {
        throw new MutationACLError('Workflow execution upsert failed: use insert operation only', 'workflow_executions');
    }
}