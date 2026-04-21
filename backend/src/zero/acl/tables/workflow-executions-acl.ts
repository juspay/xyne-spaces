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
        if (!args.createdBy) {
            throw new MutationACLError('Workflow execution insert failed: createdBy is required', 'workflow_executions');
        }
        const createdByUser = await tx.run(zql.users.where('id', args.createdBy).one());
        if (!createdByUser || createdByUser.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Workflow execution not found in this workspace', 'workflow_executions');
        }
        // TODO: need to add check with WorkflowExecutionUsers table as its not public currenlty
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