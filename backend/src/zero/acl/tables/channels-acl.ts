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
    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.id)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData) {
       throw new MutationACLError('Channel update failed: only channel participants can modify channel settings', 'channels');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'channels'>>, tx: Transaction<Schema>): Promise<void> {
    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.id)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN) {
       throw new MutationACLError('Channel delete failed: only channel admins can delete channels', 'channels');
    }
  }
}