import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class BoardAcl extends BaseACL<'boards'> {

    async canInsert(args: InsertValue<TableSchema<'boards'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.projectId).one());
        if (!project) {
            throw new MutationACLError('Board insert failed: the specified project does not exist', 'boards');
        }
        const channel = await tx
            .run(
            zql.channels
            .where('projectId', args.projectId)
            .whereExists('participants', (participants) => {
                return participants.where('userId', this.ctx.userID)
            }));
        if (channel.length === 0) {
            throw new MutationACLError('Board insert failed: you must be a project participant to create boards', 'boards');
        }
    }

    async canUpdate(args: UpdateValue<TableSchema<'boards'>>, tx: Transaction<Schema>): Promise<void> {
        const board = await tx.run(zql.boards.where('id', args.id).one());
        if (!board) {
            throw new MutationACLError('Board update failed: board does not exist', 'boards');
        }
        if (board.createdBy !== this.ctx.userID) {
            throw new MutationACLError('Board update failed: only the board creator can modify this board', 'boards');
        }
    }

    async canDelete(args: DeleteID<TableSchema<'boards'>>, tx: Transaction<Schema>): Promise<void> {
        const board = await tx.run(zql.boards.where('id', args.id).one());
        if (!board) {
            throw new MutationACLError('Board delete failed: board does not exist', 'boards');
        }
        if (board.createdBy !== this.ctx.userID) {
            throw new MutationACLError('Board delete failed: only the board creator can delete this board', 'boards');
        }
    }
}