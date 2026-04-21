import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, CanvasVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';


export class CanvasParticipantsACL extends BaseACL<'canvas_participants'> {

  private async verifyWorkspace(canvasId: string, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas) throw new MutationACLError('Canvas participant not found: canvas does not exist', 'canvas_participants');
    if (!canvas.channelId) throw new MutationACLError('Canvas participant not found: canvas has no channel', 'canvas_participants');
    const channel = await tx.run(zql.channels.where('id', canvas.channelId).one());
    if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas participant not found in this workspace', 'canvas_participants');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'canvas_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', args.canvasId).one());
    if (!canvas) {
      throw new MutationACLError('Canvas participant insert failed: the specified canvas does not exist', 'canvas_participants');
    }
    await this.verifyWorkspace(args.canvasId, tx);
    if (canvas.visibility === CanvasVisibility.PUBLIC) {
      return; // Anyone can be added to a public canvas
    }
    const participantExists = await tx
      .run(
      zql.canvas_participants
      .where('canvasId', args.canvasId)
      .one());

    if (!participantExists) {
      return
    }

    const isRequesterParticipant = await tx
      .run(
      zql.canvas_participants
      .where('canvasId', args.canvasId)
      .where('userId', this.ctx.userID)
      .one());

    if (!isRequesterParticipant) {
      throw new MutationACLError('Canvas participant insert failed: you must be a canvas participant to add others', 'canvas_participants');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const canvasParticipant = await tx.run(zql.canvas_participants.where('id', args.id).one());
    if (!canvasParticipant) {
      throw new MutationACLError('Canvas participant update failed: participant record does not exist', 'canvas_participants');
    }
    await this.verifyWorkspace(canvasParticipant.canvasId, tx);
    if (args.role) {
      const isRequesterParticipant = await tx
        .run(
        zql.canvas_participants
        .where('canvasId', canvasParticipant.canvasId)
        .where('userId', this.ctx.userID)
        .one());
      const canUpdateRole = isRequesterParticipant && (isRequesterParticipant.role === CanvasRole.OWNER || isRequesterParticipant.role === CanvasRole.EDITOR);
      if (!canUpdateRole) {
        throw new MutationACLError('Canvas participant update failed: only canvas owners or editors can change participant roles', 'canvas_participants');
      }
      // Additional check: editors cannot grant owner role
      if (isRequesterParticipant.role === CanvasRole.EDITOR && args.role === CanvasRole.OWNER) {
        throw new MutationACLError('Canvas participant update failed: editors cannot grant owner role', 'canvas_participants');
      }
    }


    
    if (args.userId || args.canvasId) {
      throw new MutationACLError('Canvas participant update failed: userId and canvasId are immutable fields', 'canvas_participants');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'canvas_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const canvasParticipant = await tx.run(zql.canvas_participants.where('id', args.id).one());
    if (!canvasParticipant) {
      throw new MutationACLError('Canvas participant delete failed: participant record does not exist', 'canvas_participants');
    }
    await this.verifyWorkspace(canvasParticipant.canvasId, tx);
    if (canvasParticipant.userId === this.ctx.userID) {
      return; // Participants can remove themselves
    }
    const isRequesterParticipant = await tx
      .run(
        zql.canvas_participants
        .where('canvasId', canvasParticipant.canvasId)
        .where('userId', this.ctx.userID)// 
        .one()
      );
    const canRemove = isRequesterParticipant &&  (isRequesterParticipant.role === CanvasRole.OWNER || isRequesterParticipant.role === CanvasRole.EDITOR);
    if (!canRemove) {
      throw new MutationACLError('Canvas participant delete failed: only canvas owners or editors can remove other participants', 'canvas_participants');
    }

    // Prevent editors from removing owners
    if (isRequesterParticipant.role === CanvasRole.EDITOR && 
        canvasParticipant.role === CanvasRole.OWNER) {
      throw new MutationACLError('Canvas participant delete failed: editors cannot remove owners', 'canvas_participants');
    }
  }
}
