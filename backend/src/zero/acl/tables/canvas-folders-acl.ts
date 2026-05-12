import type { InsertValue, Transaction, UpdateValue, DeleteID } from '@rocicorp/zero';
import { ChannelRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CanvasFoldersACL extends BaseACL<'canvas_folders'> {
  private async verifyChannelWorkspace(
    channelId: string | null | undefined,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (!channelId) return;
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) {
      throw new MutationACLError(
        'Canvas folder not found: channel does not exist',
        'canvas_folders',
      );
    }
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Canvas folder not found in this workspace',
        'canvas_folders',
      );
    }
  }

  private async verifyProjectWorkspace(
    projectId: string | null | undefined,
    tx: Transaction<Schema>,
    errorMessage: string,
  ): Promise<void> {
    if (!projectId) {
      throw new MutationACLError(errorMessage, 'canvas_folders');
    }

    const project = await tx.run(zql.projects.where('id', projectId).one());
    if (!project) {
      throw new MutationACLError(errorMessage, 'canvas_folders');
    }

    if (project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(errorMessage, 'canvas_folders');
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'canvas_folders'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (!args.projectId && args.channelId) {
      throw new MutationACLError(
        'Canvas folder insert failed: channel folders must belong to a project',
        'canvas_folders',
      );
    }

    if (!args.projectId && !args.channelId) {
      return;
    }

    const projectId = args.projectId as string;
    const project = await tx.run(zql.projects.where('id', projectId).one());
    if (!project) {
      throw new MutationACLError(
        'Canvas folder insert failed: the specified project does not exist',
        'canvas_folders',
      );
    }
    await this.verifyProjectWorkspace(
      projectId,
      tx,
      'Canvas folder insert failed: project not found in this workspace',
    );

    if (args.channelId) {
      await this.verifyChannelWorkspace(args.channelId, tx);

      const channel = await tx.run(zql.channels.where('id', args.channelId).one());
      if (!channel) {
        throw new MutationACLError('Canvas folder insert failed: the specified channel does not exist', 'canvas_folders');
      }

      if (channel.projectId !== projectId) {
        throw new MutationACLError('Canvas folder insert failed: the specified channel does not belong to the project', 'canvas_folders');
      }

      const channelMembership = await tx.run(
        zql.channel_participants
          .where('channelId', args.channelId)
          .where('userId', this.ctx.userID)
          .one(),
      );

      if (!channelMembership) {
        throw new MutationACLError('Canvas folder insert failed: you must be a member of the channel', 'canvas_folders');
      }

      return;
    }

    const projectChannelMembership = await tx.run(
      zql.channels
        .where('projectId', projectId)
        .whereExists('participants', p => p.where('userId', this.ctx.userID))
        .one(),
    );

    if (!projectChannelMembership) {
      throw new MutationACLError('Canvas folder insert failed: you must be a member of a project channel', 'canvas_folders');
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'canvas_folders'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const folder = await tx.run(zql.canvas_folders.where('id', args.id).one());
    if (!folder) {
      throw new MutationACLError('Canvas folder update failed: folder not found', 'canvas_folders');
    }
    if (folder.projectId) {
      await this.verifyProjectWorkspace(
        folder.projectId,
        tx,
        'Canvas folder update failed: folder not found in this workspace',
      );
    }
    await this.verifyChannelWorkspace(folder.channelId, tx);

    const isChannelAdmin = folder.channelId
      ? Boolean(
          await tx.run(
            zql.channel_participants
              .where('channelId', folder.channelId)
              .where('userId', this.ctx.userID)
              .where('role', ChannelRole.ADMIN)
              .one(),
          ),
        )
      : false;

    if (folder.createdBy !== this.ctx.userID && !isChannelAdmin) {
      throw new MutationACLError(
        folder.channelId
          ? 'Canvas folder update failed: only the creator or a channel admin can update the folder'
          : 'Canvas folder update failed: only the creator can update the folder',
        'canvas_folders',
      );
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'canvas_folders'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const folder = await tx.run(zql.canvas_folders.where('id', args.id).one());
    if (!folder) {
      throw new MutationACLError('Canvas folder delete failed: folder not found', 'canvas_folders');
    }
    if (folder.projectId) {
      await this.verifyProjectWorkspace(
        folder.projectId,
        tx,
        'Canvas folder delete failed: folder not found in this workspace',
      );
    }
    await this.verifyChannelWorkspace(folder.channelId, tx);

    const isChannelAdmin = folder.channelId
      ? Boolean(
          await tx.run(
            zql.channel_participants
              .where('channelId', folder.channelId)
              .where('userId', this.ctx.userID)
              .where('role', ChannelRole.ADMIN)
              .one(),
          ),
        )
      : false;

    if (folder.createdBy !== this.ctx.userID && !isChannelAdmin) {
      throw new MutationACLError(
        folder.channelId
          ? 'Canvas folder delete failed: only the creator or a channel admin can delete the folder'
          : 'Canvas folder delete failed: only the creator can delete the folder',
        'canvas_folders',
      );
    }

    const canvases = await tx.run(zql.canvases.where('folderId', args.id).limit(1));
    if (canvases.length > 0) {
      throw new MutationACLError('Canvas folder delete failed: folder contains canvases', 'canvas_folders');
    }
  }
}
