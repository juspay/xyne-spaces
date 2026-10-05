import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, Schema, isDeskChannelType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class ChannelsACL extends BaseACL<'channels'> {
  private async verifyChannelInWorkspace(
    channelId: string,
    tx: Transaction<Schema>
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) {
      throw new MutationACLError('Channel not found', 'channels');
    }
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Channel not found in workspace', 'channels');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'channels'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'channels', 'insert', 'Channel');

    // Apps are published to an existing channel by its admin (channel.setPublishedApps),
    // never seeded at creation — which also keeps the column null on every new desk.
    if (args.publishedAppIds) {
      throw new MutationACLError('Channel insert failed: apps are published after the channel exists', 'channels');
    }

    if (args.projectId) {
      const project = await tx.run(zql.projects.where('id', args.projectId).one());
      if (!project) {
        throw new MutationACLError('Channel insert failed: the specified project does not exist', 'channels');
      }
      if (project.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('Channel insert failed: project not found in workspace', 'channels');
      }
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'channels'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'channels', 'update', 'Channel');
    const channel = await tx.run(zql.channels.where('id', args.id).one());
    if (!channel) {
      throw new MutationACLError('Channel update failed: channel does not exist', 'channels');
    }

    if (channel.isArchived && args.isArchived !== false) {
      throw new MutationACLError('Channel update failed: cannot update archived channel', 'channels');
    }

    await this.verifyChannelInWorkspace(args.id, tx);

    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.id)
      .where('userId', this.ctx.userID)
      .one());

    if (args.isArchived === true && (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN)) {
      throw new MutationACLError('Channel update failed: only ADMINs can archive the channel', 'channels');
    }

    if (args.showTicketsTabTicketsInChat !== undefined && channel.createdBy !== this.ctx.userID && (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN)) {
      throw new MutationACLError('Channel update failed: only ADMINs or the owner can change Tickets-tab visibility', 'channels');
    }

    if (!currentUserParticipantData) {
       throw new MutationACLError('Channel update failed: only channel participants can modify channel settings', 'channels');
    }

    // Published apps are a normal-channel feature; desks keep theirs in
    // email_channel_preferences.deskAppIds, so the column must stay null on a desk.
    if (args.publishedAppIds !== undefined) {
      if (isDeskChannelType(channel.type)) {
        throw new MutationACLError('Channel update failed: apps cannot be published to a desk channel', 'channels');
      }
      if (currentUserParticipantData.role !== ChannelRole.ADMIN) {
        throw new MutationACLError('Channel update failed: only ADMINs can publish apps to the channel', 'channels');
      }
    }

    // Only admins or channel creator can rename the channel
    if (args.name !== undefined) {
      const isAdmin = currentUserParticipantData.role === ChannelRole.ADMIN;
      const isCreator = channel.createdBy === this.ctx.userID;
      if (!isAdmin && !isCreator) {
        throw new MutationACLError('Channel update failed: only channel admins can rename the channel', 'channels');
      }
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'channels'>>, _tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'channels', 'delete', 'Channel');

    throw new MutationACLError('Channel delete failed: channels cannot be deleted, use archive instead', 'channels');
  }
}
