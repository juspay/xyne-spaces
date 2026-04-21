import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasesACL extends BaseACL<'canvases'> {

  private async verifyWorkspace(channelId: string | null | undefined, tx: Transaction<Schema>): Promise<void> {
    if (!channelId) return;
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Canvas not found: channel does not exist', 'canvases');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas not found in this workspace', 'canvases');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspace(args.channelId, tx);
    if (args.channelId) {
      const channel = await tx.run(zql.channels.where('id', args.channelId).one());
      if (!channel) {
        throw new MutationACLError('Canvas insert failed: the specified channel does not exist', 'canvases');
      }

      if (channel.isArchived) {
        throw new MutationACLError('Canvas insert failed: cannot create canvases in archived channel', 'canvases');
      }

      const isParticipant = await tx.run(zql.channel_participants
        .where('channelId', args.channelId)
        .where('userId', this.ctx.userID)
        .one());

      if (!isParticipant) {
        throw new MutationACLError('Canvas insert failed: you must be a channel member to create canvases', 'canvases');
      }
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', args.id).one());
    await this.verifyWorkspace(canvas?.channelId, tx);
    // Allow all canvas updates - permission checking is handled in the mutator
    return;
  }

  async canDelete(args: DeleteID<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', args.id).related('channel').one());

    if (!canvas) {
      throw new MutationACLError('Canvas delete failed: canvas not found', 'canvases');
    }
    await this.verifyWorkspace(canvas.channelId, tx);

    if (canvas.channel?.isArchived) {
      throw new MutationACLError('Canvas delete failed: cannot delete canvases in archived channel', 'canvases');
    }

    if (canvas.createdBy === this.ctx.userID) {
      return;
    }

    const isOwner = await tx.run(
      zql.canvas_participants
        .where('canvasId', args.id)
        .where('userId', this.ctx.userID)
        .where('role', CanvasRole.OWNER)
        .one()
    );

    if (!isOwner) {
      throw new MutationACLError('Canvas delete failed: only canvas owners can delete the canvas', 'canvases');
    }
  }
}
