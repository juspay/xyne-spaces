import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasProjectAdminAccess } from '../core/admin-access';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class StageAcl extends BaseACL<'stages'> {

    private async verifyBoardWorkspace(boardId: string, tx: Transaction<Schema>): Promise<{ board: any }> {
        const board = await tx.run(zql.boards.where('id', boardId).one());
        if (!board || board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Stage not found in this workspace', 'stages');
        }
        return { board };
    }

    // Slack-Connect: is the caller an active connect member of ANY channel belonging to this
    // board's project? Stages reach a channel only via board -> project -> channels (potentially
    // several channels), so we resolve membership across the project's channels rather than a
    // single channelId. Grants cross-org stage writes to active connect members.
    private async isConnectMemberOfBoardProject(boardId: string, tx: Transaction<Schema>): Promise<boolean> {
        const board = await tx.run(zql.boards.where('id', boardId).one());
        if (!board) return false;
        const connectChannel = await tx.run(
            zql.channels
                .where('projectId', board.projectId)
                .whereExists('connectMembers', (m: any) =>
                    m.where('userId', this.ctx.userID).where('leftAt', 'IS', null),
                )
                .one(),
        );
        return Boolean(connectChannel);
    }

    async canInsert(args: InsertValue<TableSchema<'stages'>>, tx: Transaction<Schema>): Promise<void> {
        // Slack-Connect: an active connect member of the board's project channel may add stages cross-org.
        if (await this.isConnectMemberOfBoardProject(args.boardId, tx)) return;
        assertGuestWriteBlocked(this.ctx, 'stages', 'insert', 'Stage');
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
        const existingStage = await tx.run(zql.stages.where('id', args.id).one());
        // Slack-Connect: an active connect member of the board's project channel may modify stages cross-org.
        if (existingStage && (await this.isConnectMemberOfBoardProject(existingStage.boardId, tx))) return;
        assertGuestWriteBlocked(this.ctx, 'stages', 'update', 'Stage');
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
        const existingStage = await tx.run(zql.stages.where('id', args.id).one());
        // Slack-Connect: an active connect member of the board's project channel may delete stages cross-org.
        if (existingStage && (await this.isConnectMemberOfBoardProject(existingStage.boardId, tx))) return;
        assertGuestWriteBlocked(this.ctx, 'stages', 'delete', 'Stage');
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
        // Slack-Connect: an active connect member of the board's project channel may upsert stages cross-org.
        if (await this.isConnectMemberOfBoardProject(args.boardId, tx)) return;
        assertGuestWriteBlocked(this.ctx, 'stages', 'upsert', 'Stage');
        const stage = await tx.run(zql.stages.where('id', args.id).related('board').one());
        if (!stage || !stage.board) {
            // Row doesn't exist yet → this upsert is an INSERT of a new stage (board
            // edits upsert freshly-generated stage ids). Authorize via the board,
            // same as canInsert, instead of failing on the missing row.
            const { board } = await this.verifyBoardWorkspace(args.boardId, tx);
            if (board.createdBy === this.ctx.userID) return;
            if (await hasProjectAdminAccess(this.ctx, tx)) return;
            throw new MutationACLError('Stage upsert failed: only the board creator or project admin can add stages', 'stages');
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
