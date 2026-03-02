import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasProjectAdminAccess } from '../core/admin-access';

export class StageAcl extends BaseACL<'stages'> {

    async canInsert(args: InsertValue<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        const boardWithProject = await tx.run(zql.boards.where('id', args.boardId).related('project').one());

        if (!boardWithProject || !boardWithProject.project) {
            throw new MutationACLError('Stage insert failed: the specified board does not exist or has no project', 'stages');
        }

        // Allow if user is the board creator
        if (boardWithProject.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Stage insert failed: only the board creator or project admin can add stages', 'stages');
    }

    async canUpdate(args: UpdateValue<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        const stage = await tx.run(zql.stages.where('id', args.id).related('board').one());
        if (!stage || !stage.board) {
            throw new MutationACLError('Stage update failed: stage or its board does not exist', 'stages');
        }

        // Allow if user is the board creator
        if (stage.board.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Stage update failed: only the board creator or project admin can modify stages', 'stages');
    }

    async canDelete(args: DeleteID<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        const stage = await tx.run(zql.stages.where('id', args.id).related('board').one());
        if (!stage || !stage.board) {
            throw new MutationACLError('Stage delete failed: stage or its board does not exist', 'stages');
        }

        // Allow if user is the board creator
        if (stage.board.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Stage delete failed: only the board creator or project admin can delete stages', 'stages');
    }

    async canUpsert(args: UpsertValue<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        const stage = await tx.run(zql.stages.where('id', args.id).related('board').one());
        if (!stage || !stage.board) {
            throw new MutationACLError('Stage upsert failed: stage or its board does not exist', 'stages');
        }

        // Allow if user is the board creator
        if (stage.board.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Stage upsert failed: only the board creator or project admin can modify stages', 'stages');
    }
}