import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ChannelStatsACL extends BaseACL<'channel_stats'> {
  async canInsert(_args: InsertValue<TableSchema<'channel_stats'>>, _tx: Transaction<Schema>): Promise<void> {
      // Any user can create channel stats
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_stats'>>, tx: Transaction<Schema>): Promise<void> {
    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData) {
       throw new MutationACLError('Channel stats update failed: only channel participants can modify channel stats', 'channel_stats');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'channel_stats'>>, tx: Transaction<Schema>): Promise<void> {
    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN) {
       throw new MutationACLError('Channel stats delete failed: only channel admins can delete channel stats', 'channel_stats');
    }
  }
}
