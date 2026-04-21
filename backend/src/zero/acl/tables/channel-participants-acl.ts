import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, ChannelScopeType, ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import {MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ChannelParticipantsACL extends BaseACL<'channel_participants'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const channelWorkspaceId = workspaceId ?? await tx.run(zql.channels.where('id', channelId).one()).then(c => c?.workspaceId);
    if (!channelWorkspaceId) throw new MutationACLError('Channel participant not found: channel does not exist', 'channel_participants');
    if (channelWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Channel participant not found in this workspace', 'channel_participants');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'channel_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', '=', args.channelId).one());
    if (!channel) throw new MutationACLError('Channel participant insert failed: channel does not exist', 'channel_participants');

    if (channel?.isArchived) {
      throw new MutationACLError('Channel participant insert failed: cannot join archived channel', 'channel_participants');
    }

    if (channel?.scopeType === ChannelScopeType.DM) {
      const existingParticipants = await tx.run(zql.channel_participants
        .where('channelId', '=', args.channelId));
      if (existingParticipants.length >= 2) {
        throw new MutationACLError('Channel participant insert failed: cannot add more than 2 participants to a DM channel', 'channel_participants');
      }
    }

    await this.verifyChannelInWorkspace(args.channelId, tx, channel.workspaceId); 
    const existingParticipant = await tx.run(zql.channel_participants
      .where('channelId', '=', args.channelId)
      .where('userId', '=', this.ctx.userID)
      .one());

    if (channel?.visibility === ChannelVisibility.PUBLIC || existingParticipant) {
      return
    }
    throw new MutationACLError('Channel participant insert failed: you must be a channel member or the channel must be public', 'channel_participants');
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.channel_participants.where('id', '=', args.id).related('channel').one());
    if (!participant || !participant.channel) {
      throw new MutationACLError('Channel participant update failed: participant record does not exist', 'channel_participants');
    }

    if (participant.channel.isArchived) {
      throw new MutationACLError('Channel participant update failed: cannot update participants in archived channel', 'channel_participants');
    }

    await this.verifyChannelInWorkspace(participant.channelId, tx);
    const userParticipationData = await tx.run(zql.channel_participants.where('channelId', '=', participant.channelId).where('userId', '=', this.ctx.userID).one());

    if (userParticipationData?.role === ChannelRole.ADMIN || userParticipationData?.userId === this.ctx.userID) {
      return;
    }
    throw new MutationACLError('Channel participant update failed: only channel admins can modify participant data', 'channel_participants');
  }

  async canDelete(args: DeleteID<TableSchema<'channel_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.channel_participants.where('id', '=', args.id).related('channel').one());

    if (!participant || !participant.channel) {
      throw new MutationACLError('Channel participant delete failed: participant record does not exist', 'channel_participants');
    }
    await this.verifyChannelInWorkspace(participant.channelId, tx); 

    if (participant.channel.isArchived) {
      throw new MutationACLError('Channel participant delete failed: cannot delete participants in archived channel', 'channel_participants');
    }

    if (participant.userId === this.ctx.userID) {
      throw new MutationACLError('Channel participant delete failed: cannot delete participants in archived channel', 'channel_participants');
    }

    if (participant.userId === this.ctx.userID) {
      if (participant.role === ChannelRole.ADMIN) {
        const otherAdmins = await tx.run(zql.channel_participants
          .where('channelId', '=', participant.channelId)
          .where('role', '=', ChannelRole.ADMIN));

        if (otherAdmins.length === 1) {
          throw new MutationACLError('Cannot leave channel: you are the only admin', 'channel_participants'); 
        }
      }
      return;
    }

    const userParticipationData = await tx.run(zql.channel_participants.where('channelId', '=', participant.channelId).where('userId', '=', this.ctx.userID).one());
    if (userParticipationData?.role === ChannelRole.ADMIN) {
      return;
    }
    throw new MutationACLError('Channel participant delete failed: only admins can remove other participants', 'channel_participants');
  }
}