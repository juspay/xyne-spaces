import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasUserStatusACL extends BaseACL<'canvas_user_status'> {
  private async verifyCanvasAccess(canvasId: string, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas) {
      throw new MutationACLError(
        'Canvas user status failed: canvas does not exist',
        'canvas_user_status',
      );
    }

    if (canvas.channelId) {
      const channel = await tx.run(zql.channels.where('id', canvas.channelId).one());
      if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError(
          'Canvas user status not found in this workspace',
          'canvas_user_status',
        );
      }
      return;
    }

    const isCreator = canvas.createdBy === this.ctx.userID;
    const isParticipant = await tx.run(
      zql.canvas_participants.where('canvasId', canvasId).where('userId', this.ctx.userID).one(),
    );

    if (!isCreator && !isParticipant && canvas.visibility !== CanvasVisibility.PUBLIC) {
      throw new MutationACLError(
        'Canvas user status failed: you do not have access to this canvas',
        'canvas_user_status',
      );
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'canvas_user_status'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Canvas user status insert failed: you can only create your own status row',
        'canvas_user_status',
      );
    }

    await this.verifyCanvasAccess(args.canvasId, tx);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'canvas_user_status'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const status = await tx.run(zql.canvas_user_status.where('id', args.id).one());
    if (!status) {
      throw new MutationACLError(
        'Canvas user status update failed: status row does not exist',
        'canvas_user_status',
      );
    }

    await this.verifyCanvasAccess(status.canvasId, tx);

    if (status.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Canvas user status update failed: you can only modify your own status row',
        'canvas_user_status',
      );
    }

    if (args.userId !== undefined || args.canvasId !== undefined) {
      throw new MutationACLError(
        'Canvas user status update failed: canvasId and userId are immutable',
        'canvas_user_status',
      );
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'canvas_user_status'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const status = await tx.run(zql.canvas_user_status.where('id', args.id).one());
    if (!status) {
      throw new MutationACLError(
        'Canvas user status delete failed: status row does not exist',
        'canvas_user_status',
      );
    }

    await this.verifyCanvasAccess(status.canvasId, tx);

    if (status.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Canvas user status delete failed: you can only delete your own status row',
        'canvas_user_status',
      );
    }
  }
}
