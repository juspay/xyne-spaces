import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ChannelsACL extends BaseACL<'channels'> {
  async canInsert(_args: InsertValue<TableSchema<'channels'>>, _tx: Transaction<Schema>): Promise<void> {
      // Any user can create a channel
  }

  async canUpdate(args: UpdateValue<TableSchema<'channels'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.id).one());
    if (!channel) {
      throw new MutationACLError('Channel update failed: channel does not exist', 'channels');
    }

    if (channel.isArchived && args.isArchived !== false) {
      throw new MutationACLError('Channel update failed: cannot update archived channel', 'channels');
    }

    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.id)
      .where('userId', this.ctx.userID)
      .one());

    if (args.isArchived === true && (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN)) {
      throw new MutationACLError('Channel update failed: only ADMINs can archive the channel', 'channels');
    }

    if (!currentUserParticipantData) {
       throw new MutationACLError('Channel update failed: only channel participants can modify channel settings', 'channels');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'channels'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Channel delete failed: channels cannot be deleted, use archive instead', 'channels');
  }
}