import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasGuestChannelAccess } from '../core/guest-access';

export class ChannelStatsACL extends BaseACL<'channel_stats'> {
  async canInsert(args: InsertValue<TableSchema<'channel_stats'>>, tx: Transaction<Schema>): Promise<void> {
      if (this.ctx.role === 'GUEST') {
        const hasGuestAccess = await hasGuestChannelAccess(this.ctx, tx, args.channelId);
        if (!hasGuestAccess) {
          throw new MutationACLError('Channel stats insert failed: guest does not have access to this channel', 'channel_stats');
        }
      }
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_stats'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasGuestChannelAccess(this.ctx, tx, args.channelId);
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Channel stats update failed: guest does not have access to this channel', 'channel_stats');
    }

    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData) {
       throw new MutationACLError('Channel stats update failed: only channel participants can modify channel stats', 'channel_stats');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'channel_stats'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasGuestChannelAccess(this.ctx, tx, args.channelId);
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Channel stats delete failed: guest does not have access to this channel', 'channel_stats');
    }

    const currentUserParticipantData = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (!currentUserParticipantData || currentUserParticipantData.role !== ChannelRole.ADMIN) {
       throw new MutationACLError('Channel stats delete failed: only channel admins can delete channel stats', 'channel_stats');
    }
  }
}
