import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { CanvasRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasLabelsACL extends BaseACL<'canvas_labels'> {
  private async getRequesterEffectiveRole(
    canvasId: string,
    tx: Transaction<Schema>,
  ): Promise<CanvasRole | null> {
    const direct = await tx.run(
      zql.canvas_participants.where('canvasId', canvasId).where('userId', this.ctx.userID).one(),
    );
    if (direct) return direct.role;

    const groupMappings = await tx.run(zql.user_group_mappings.where('userId', this.ctx.userID));
    const userGroupIds = groupMappings.map(mapping => mapping.userGroupId);
    if (userGroupIds.length > 0) {
      const groupParticipant = await tx.run(
        zql.canvas_participants
          .where('canvasId', canvasId)
          .where('userGroupId', 'IN', userGroupIds)
          .where('role', 'IN', [CanvasRole.OWNER, CanvasRole.EDITOR])
          .one(),
      );
      if (groupParticipant) return groupParticipant.role;
    }

    const channelMemberships = await tx.run(zql.channel_participants.where('userId', this.ctx.userID));
    const channelIds = channelMemberships.map(membership => membership.channelId);
    if (channelIds.length > 0) {
      const channelParticipant = await tx.run(
        zql.canvas_participants
          .where('canvasId', canvasId)
          .where('channelId', 'IN', channelIds)
          .where('role', 'IN', [CanvasRole.OWNER, CanvasRole.EDITOR])
          .one(),
      );
      if (channelParticipant) return channelParticipant.role;
    }

    return null;
  }

  private async assertCanEditCanvas(canvasId: string, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas) {
      throw new MutationACLError('Canvas label write failed: canvas does not exist', 'canvas_labels');
    }
    if (canvas.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas label write failed: canvas not found in this workspace', 'canvas_labels');
    }
    if (canvas.createdBy === this.ctx.userID) return;

    const role = await this.getRequesterEffectiveRole(canvasId, tx);
    if (role !== CanvasRole.OWNER && role !== CanvasRole.EDITOR) {
      throw new MutationACLError('Canvas label write failed: only canvas owners or editors can manage labels', 'canvas_labels');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'canvas_labels'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas label insert failed: workspace mismatch', 'canvas_labels');
    }
    await this.assertCanEditCanvas(args.canvasId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'canvas_labels'>>, tx: Transaction<Schema>): Promise<void> {
    const label = await tx.run(zql.canvas_labels.where('id', args.id).one());
    if (!label) {
      throw new MutationACLError('Canvas label delete failed: label does not exist', 'canvas_labels');
    }
    if (label.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas label delete failed: workspace mismatch', 'canvas_labels');
    }
    await this.assertCanEditCanvas(label.canvasId, tx);
  }

  async canUpdate(_args: UpdateValue<TableSchema<'canvas_labels'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Canvas label update failed: labels must be added or removed', 'canvas_labels');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'canvas_labels'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Canvas label upsert failed: labels must be added or removed', 'canvas_labels');
  }
}
