import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  CanvasHierarchyResolutionError,
  type CanvasHierarchyErrorCode,
  CanvasRole,
  resolveCanvasHierarchy,
  Schema,
} from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasesACL extends BaseACL<'canvases'> {
  private mapInsertHierarchyError(code: CanvasHierarchyErrorCode): string {
    switch (code) {
      case 'FOLDER_NOT_FOUND':
        return 'Canvas insert failed: the specified folder does not exist';
      case 'FOLDER_PROJECT_MISMATCH':
        return 'Canvas insert failed: folder must belong to the specified project';
      case 'FOLDER_CHANNEL_MISMATCH':
        return 'Canvas insert failed: channel folder must be used with its channel';
      case 'PROJECT_FOLDER_IN_CHANNEL':
        return 'Canvas insert failed: folder without a channel cannot be used inside a channel';
      case 'CHANNEL_NOT_FOUND':
        return 'Canvas insert failed: the specified channel does not exist';
      case 'CHANNEL_PROJECT_MISMATCH':
        return 'Canvas insert failed: channel must belong to the specified project';
      default:
        return 'Canvas insert failed: invalid canvas hierarchy';
    }
  }

  private async verifyWorkspace(channelId: string | null | undefined, tx: Transaction<Schema>): Promise<void> {
    if (!channelId) return;
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Canvas not found: channel does not exist', 'canvases');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Canvas not found in this workspace', 'canvases');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    let resolvedProjectId = args.projectId;
    let resolvedChannelId = args.channelId;

    try {
      const hierarchy = await resolveCanvasHierarchy({
        folderId: args.folderId,
        projectId: args.projectId,
        channelId: args.channelId,
        loadFolder: folderId => tx.run(zql.canvas_folders.where('id', folderId).one()),
        loadChannel: channelId => tx.run(zql.channels.where('id', channelId).one()),
      });

      resolvedProjectId = hierarchy.projectId;
      resolvedChannelId = hierarchy.channelId;
    } catch (error) {
      if (error instanceof CanvasHierarchyResolutionError) {
        throw new MutationACLError(this.mapInsertHierarchyError(error.code), 'canvases');
      }
      throw error;
    }

    await this.verifyWorkspace(resolvedChannelId, tx);

    if (resolvedChannelId) {
      const channel = await tx.run(zql.channels.where('id', resolvedChannelId).one());
      if (!channel) {
        throw new MutationACLError(
          'Canvas insert failed: the specified channel does not exist',
          'canvases',
        );
      }

      if (channel.isArchived) {
        throw new MutationACLError(
          'Canvas insert failed: cannot create canvases in archived channel',
          'canvases',
        );
      }

      const isParticipant = await tx.run(
        zql.channel_participants
          .where('channelId', resolvedChannelId)
          .where('userId', this.ctx.userID)
          .one(),
      );

      if (!isParticipant) {
        throw new MutationACLError(
          'Canvas insert failed: you must be a channel member to create canvases',
          'canvases',
        );
      }
    } else if (resolvedProjectId) {
      const projectChannelMembership = await tx.run(
        zql.channels
          .where('projectId', resolvedProjectId)
          .whereExists('participants', p => p.where('userId', this.ctx.userID))
          .one(),
      );

      if (!projectChannelMembership) {
        throw new MutationACLError(
          'Canvas insert failed: you must be a member of a project channel',
          'canvases',
        );
      }
    }
  }

  /**
   * Canvas updates intentionally use a split authorization model:
   *
   * 1. ACL layer here only enforces workspace scoping / row existence.
   * 2. Fine-grained authorization lives in `canvas.update` mutator because it depends on
   *    request-level semantics that are not available in this generic table ACL, such as:
   *    - treating folder/project/channel changes as move operations
   *    - allowing channel admins to move canvases even when they are not canvas editors
   *
   * Keep this method permissive after workspace validation, and route business authorization
   * changes through the mutator. If a new code path updates `canvases` directly, it must reuse
   * the same mutator-level checks or this assumption becomes unsafe.
   */
  async canUpdate(args: UpdateValue<TableSchema<'canvases'>>, tx: Transaction<Schema>): Promise<void> {
    const canvas = await tx.run(zql.canvases.where('id', args.id).one());
    await this.verifyWorkspace(canvas?.channelId, tx);
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
