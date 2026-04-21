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

    private async verifyBoardWorkspace(boardId: string, tx: Transaction<Schema>): Promise<{ board: any }> {
        const board = await tx.run(zql.boards.where('id', boardId).one());
        if (!board || board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Stage not found in this workspace', 'stages');
        }
        return { board };
    }

    async canInsert(args: InsertValue<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        const { board } = await this.verifyBoardWorkspace(args.boardId, tx);

        // Allow if user is the board creator
        if (board.createdBy === this.ctx.userID) {
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
        
        // Direct workspaceId check - no project lookup needed
        if (stage.board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Stage update failed: workspace ID mismatch', 'stages');
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
        
        // Direct workspaceId check - no project lookup needed
        if (stage.board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Stage delete failed: workspace ID mismatch', 'stages');
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
        
        // Direct workspaceId check - no project lookup needed
        if (stage.board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Stage upsert failed: workspace ID mismatch', 'stages');
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