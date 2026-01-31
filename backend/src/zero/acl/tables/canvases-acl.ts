import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasesACL extends BaseACL<'canvases'> {

  async canInsert(args: InsertValue<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.channelId) {
      const channel = await tx.run(zql.channels.where('id', args.channelId).one());
      if (!channel) {
        throw new MutationACLError('Canvas insert failed: the specified channel does not exist', 'canvases');
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

  async canUpdate(_args: UpdateValue<TableSchema<'canvases'>>, _tx: Transaction<Schema>): Promise<void> {
    // const isParticipant = await tx
    //   .query
    //   .canvas_participants
    //   .where('canvasId', args.id)
    //   .where('userId', this.ctx.userID)
    //   .one()
    //   .run();

    // if (!isParticipant) {
    //   throw new MutationACLError('Canvas update failed: only canvas participants can modify the canvas', 'canvases');
    // }
    // Allow all canvas updates - permission checking is handled in the mutator
    return;
  }

  async canDelete(args: DeleteID<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    // Check if user is the creator of the canvas
    const canvas = await tx.run(zql.canvases.where('id', args.id).one());
    
    if (!canvas) {
      throw new MutationACLError('Canvas delete failed: canvas not found', 'canvases');
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
