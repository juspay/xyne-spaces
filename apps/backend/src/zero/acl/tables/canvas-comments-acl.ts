import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasCommentsACL extends BaseACL<'canvas_comments'> {
  private async canEditCanvas(canvasId: string, tx: Transaction<Schema>): Promise<boolean> {
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas) {
      throw new MutationACLError('Canvas comment failed: canvas not found', 'canvas_comments');
    }

    if (canvas.createdBy === this.ctx.userID) return true;

    const participant = await tx.run(
      zql.canvas_participants
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

  async canInsert(args: InsertValue<TableSchema<'canvas_comments'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas comment insert failed: workspace mismatch', 'canvas_comments');
    }

    const thread = await tx.run(
      zql.canvas_comment_threads.where('id', args.threadId).one(),
    );
    if (!thread || thread.canvasId !== args.canvasId) {
      throw new MutationACLError('Canvas comment insert failed: thread not found', 'canvas_comments');
    }

    if (!(await this.canEditCanvas(args.canvasId, tx))) {
      throw new MutationACLError('Canvas comment insert failed: edit access required', 'canvas_comments');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_comments'>>, tx: Transaction<Schema>): Promise<void> {
    const comment = await tx.run(
      zql.canvas_comments.where('id', args.id).one(),
    );
    if (!comment) {
      throw new MutationACLError('Canvas comment update failed: comment not found', 'canvas_comments');
    }

    if (comment.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Canvas comment update failed: only the author can edit this comment', 'canvas_comments');
    }
  }
}
