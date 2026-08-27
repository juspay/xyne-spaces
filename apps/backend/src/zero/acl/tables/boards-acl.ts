import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasProjectAdminAccess } from '../core/admin-access';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class BoardAcl extends BaseACL<'boards'> {

    // Slack-Connect: is the caller an active connect member of ANY channel of this project?
    // Boards reach a channel only via project -> channels (potentially several), so we resolve
    // membership across the project's channels. Grants cross-org board writes to connect members.
    private async isConnectMemberOfProject(projectId: string, tx: Transaction<Schema>): Promise<boolean> {
        const connectChannel = await tx.run(
            zql.channels
                .where('projectId', projectId)
                .whereExists('connectMembers', (m: any) =>
                    m.where('userId', this.ctx.userID).where('leftAt', 'IS', null),
                )
                .one(),
        );
        return Boolean(connectChannel);
    }

    async canInsert(args: InsertValue<TableSchema<'boards'>>, tx: Transaction<Schema>): Promise<void> {
        // Slack-Connect: an active connect member of the project's channel may create boards cross-org.
        if (args.projectId && (await this.isConnectMemberOfProject(args.projectId, tx))) return;
        assertGuestWriteBlocked(this.ctx, 'boards', 'insert', 'Board');
        // Verify board's workspaceId matches context (direct check, no project lookup)
        if (args.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Board insert failed: workspace ID mismatch', 'boards');
        }

        // Verify project exists and belongs to the same workspace
        const project = await tx.run(zql.projects.where('id', args.projectId).one());
        if (!project) {
            throw new MutationACLError('Board insert failed: the specified project does not exist', 'boards');
        }
        if (project.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Board insert failed: project workspace mismatch', 'boards');
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
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
        const existingBoard = await tx.run(zql.boards.where('id', args.id).one());
        // Slack-Connect: an active connect member of the project's channel may modify boards cross-org.
        if (existingBoard && (await this.isConnectMemberOfProject(existingBoard.projectId, tx))) return;
        assertGuestWriteBlocked(this.ctx, 'boards', 'update', 'Board');
        const board = await tx.run(zql.boards.where('id', args.id).one());
        if (!board) {
            throw new MutationACLError('Board update failed: board does not exist', 'boards');
        }
        
        // Direct workspaceId check - no need to traverse through project
        if (board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Board update failed: workspace ID mismatch', 'boards');
        }

        // Allow if user is the creator
        if (board.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Board update failed: only the board creator or project admin can modify this board', 'boards');
    }

    async canDelete(args: DeleteID<TableSchema<'boards'>>, tx: Transaction<Schema>): Promise<void> {
        const existingBoard = await tx.run(zql.boards.where('id', args.id).one());
        // Slack-Connect: an active connect member of the project's channel may delete boards cross-org.
        if (existingBoard && (await this.isConnectMemberOfProject(existingBoard.projectId, tx))) return;
        assertGuestWriteBlocked(this.ctx, 'boards', 'delete', 'Board');
        const board = await tx.run(zql.boards.where('id', args.id).one());
        if (!board) {
            throw new MutationACLError('Board delete failed: board does not exist', 'boards');
        }
        
        // Direct workspaceId check - no need to traverse through project
        if (board.workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Board delete failed: workspace ID mismatch', 'boards');
        }

        // Allow if user is the creator
        if (board.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Board delete failed: only the board creator or project admin can delete this board', 'boards');
    }
}
