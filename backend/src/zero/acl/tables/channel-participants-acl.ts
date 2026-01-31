import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import {MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ChannelParticipantsACL extends BaseACL<'channel_participants'> {

  async canInsert(args: InsertValue<TableSchema<'channel_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', '=', args.channelId).one());
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
    const participant = await tx.run(zql.channel_participants.where('id', '=', args.id).one());
    if (!participant) {
      throw new MutationACLError('Channel participant update failed: participant record does not exist', 'channel_participants');
    }
    const userParticipationData = await tx.run(zql.channel_participants.where('channelId', '=', participant.channelId).where('userId', '=', this.ctx.userID).one());

    if (userParticipationData?.role === ChannelRole.ADMIN || userParticipationData?.userId === this.ctx.userID) {
      return;
    }
    throw new MutationACLError('Channel participant update failed: only channel admins can modify participant data', 'channel_participants');
  }

  async canDelete(args: DeleteID<TableSchema<'channel_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.channel_participants.where('id', '=', args.id).one());

    if (!participant) {
      throw new MutationACLError('Channel participant delete failed: participant record does not exist', 'channel_participants');
    }

    if (participant?.userId === this.ctx.userID) {
      return;
    }

    const userParticipationData = await tx.run(zql.channel_participants.where('channelId', '=', participant?.channelId).where('userId', '=', this.ctx.userID).one());
    if (userParticipationData?.role === ChannelRole.ADMIN) {
      return;
    }
    throw new MutationACLError('Channel participant delete failed: only admins can remove other participants', 'channel_participants');
  }
}