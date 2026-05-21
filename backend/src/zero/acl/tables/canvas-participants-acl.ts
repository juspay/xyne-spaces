import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { CanvasRole, CanvasVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';


export class CanvasParticipantsACL extends BaseACL<'canvas_participants'> {

  private roleRank(role: CanvasRole): number {
    return role === CanvasRole.OWNER ? 3 : role === CanvasRole.EDITOR ? 2 : role === CanvasRole.VIEWER ? 1 : 0;
  }

  private strongerRole(a: CanvasRole | null, b: CanvasRole | null): CanvasRole | null {
    if (!a) return b;
    if (!b) return a;
    return this.roleRank(a) >= this.roleRank(b) ? a : b;
  }

  /** Effective canvas role for the requester: direct row, else strongest of group- and channel-based rows. */
  private async getRequesterEffectiveRole(canvasId: string, tx: Transaction<Schema>): Promise<CanvasRole | null> {
    const direct = await tx.run(
      zql.canvas_participants.where('canvasId', canvasId).where('userId', this.ctx.userID).one(),
    );
    if (direct) return direct.role;

    const mappings = await tx.run(zql.user_group_mappings.where('userId', this.ctx.userID));
    const groupIds = mappings.map(m => m.userGroupId);
    let groupBest: CanvasRole | null = null;
    if (groupIds.length > 0) {
      const groupParticipants = await tx.run(
        zql.canvas_participants
          .where('canvasId', canvasId)
          .where('userGroupId', 'IN', groupIds),
      );
      for (const p of groupParticipants) {
        groupBest = this.strongerRole(groupBest, p.role);
      }
    }

    const myChannels = await tx.run(zql.channel_participants.where('userId', this.ctx.userID));
    const channelIds = myChannels.map(cp => cp.channelId);
    let channelBest: CanvasRole | null = null;
    if (channelIds.length > 0) {
      const channelParticipants = await tx.run(
        zql.canvas_participants
          .where('canvasId', canvasId)
          .where('channelId', 'IN', channelIds),
      );
      for (const p of channelParticipants) {
        channelBest = this.strongerRole(channelBest, p.role);
      }
    }

    return this.strongerRole(groupBest, channelBest);
  }

  private async verifyWorkspace(canvasId: string, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas) throw new MutationACLError('Canvas participant not found: canvas does not exist', 'canvas_participants');
    
    // If canvas has channel, verify through channel
    if (canvas.channelId) {
      const channel = await tx.run(zql.channels.where('id', canvas.channelId).one());
      if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('Canvas participant not found in this workspace', 'canvas_participants');
      }
      return;
    }
    
    // If no channel, verify through canvas creator's workspace
    // The ctx.workspaceId is already set from the user's workspace, 
    // and userId is workspace-scoped, so just verify canvas exists
    // Canvas without channel can only be accessed by creator initially
    const isCreator = canvas.createdBy === this.ctx.userID;
    if (!isCreator) {
      const effective = await this.getRequesterEffectiveRole(canvasId, tx);
      if (!effective) {
        throw new MutationACLError('Canvas participant not found in this workspace', 'canvas_participants');
      }
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

    const effectiveRole = await this.getRequesterEffectiveRole(args.canvasId, tx);

    if (!effectiveRole) {
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
      const effectiveRole = await this.getRequesterEffectiveRole(canvasParticipant.canvasId, tx);
      const canUpdateRole =
        effectiveRole === CanvasRole.OWNER || effectiveRole === CanvasRole.EDITOR;
      if (!canUpdateRole) {
        throw new MutationACLError('Canvas participant update failed: only canvas owners or editors can change participant roles', 'canvas_participants');
      }
      // Additional check: editors cannot grant owner role
      if (effectiveRole === CanvasRole.EDITOR && args.role === CanvasRole.OWNER) {
        throw new MutationACLError('Canvas participant update failed: editors cannot grant owner role', 'canvas_participants');
      }
    }


    
    if (args.userId || args.userGroupId || args.channelId || args.canvasId) {
      throw new MutationACLError('Canvas participant update failed: userId, userGroupId, channelId and canvasId are immutable fields', 'canvas_participants');
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
    const effectiveRole = await this.getRequesterEffectiveRole(canvasParticipant.canvasId, tx);
    const canRemove =
      effectiveRole === CanvasRole.OWNER || effectiveRole === CanvasRole.EDITOR;
    if (!canRemove) {
      throw new MutationACLError('Canvas participant delete failed: only canvas owners or editors can remove other participants', 'canvas_participants');
    }

    // Prevent editors from removing owners
    if (effectiveRole === CanvasRole.EDITOR && 
        canvasParticipant.role === CanvasRole.OWNER) {
      throw new MutationACLError('Canvas participant delete failed: editors cannot remove owners', 'canvas_participants');
    }
  }
}
