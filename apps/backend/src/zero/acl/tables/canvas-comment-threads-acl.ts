import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasCommentThreadsACL extends BaseACL<'canvas_comment_threads'> {
  private async canEditCanvas(canvasId: string, tx: Transaction<Schema>): Promise<boolean> {
    const canvas = await tx.run(
      zql.canvases.where('id', canvasId).where('workspaceId', this.ctx.workspaceId).one(),
    );
    if (!canvas) {
      throw new MutationACLError('Canvas comment thread failed: canvas not found', 'canvas_comment_threads');
    }

    if (canvas.createdBy === this.ctx.userID) return true;

    const participant = await tx.run(
      zql.canvas_participants
        .where('workspaceId', this.ctx.workspaceId)
        .where('canvasId', canvasId)
        .where('role', 'IN', [CanvasRole.EDITOR, CanvasRole.OWNER])
        .where(({ or, cmp, exists: ex }: any) =>
          or(
            cmp('userId', this.ctx.userID),
            ex('userGroup', (ug: any) =>
              ug.whereExists('userGroupMappings', (m: any) => m.where('userId', this.ctx.userID)),
            ),
            ex('channel', (ch: any) =>
              ch.whereExists('participants', (cp: any) => cp.where('userId', this.ctx.userID)),
            ),
          ),
        )
        .one(),
    );

    return Boolean(participant);
  }

  async canInsert(args: InsertValue<TableSchema<'canvas_comment_threads'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Canvas comment thread insert failed: workspace mismatch',
        'canvas_comment_threads',
      );
    }

    if (!(await this.canEditCanvas(args.canvasId, tx))) {
      throw new MutationACLError('Canvas comment thread insert failed: edit access required', 'canvas_comment_threads');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_comment_threads'>>, tx: Transaction<Schema>): Promise<void> {
    const thread = await tx.run(
      zql.canvas_comment_threads
        .where('id', args.id)
        .where('workspaceId', this.ctx.workspaceId)
        .one(),
    );
    if (!thread) {
      throw new MutationACLError('Canvas comment thread update failed: thread not found', 'canvas_comment_threads');
    }

    if (thread.createdBy === this.ctx.userID) {
      return;
    }

    if (!(await this.canEditCanvas(thread.canvasId, tx))) {
      throw new MutationACLError('Canvas comment thread update failed: edit access required', 'canvas_comment_threads');
    }
  }
}
