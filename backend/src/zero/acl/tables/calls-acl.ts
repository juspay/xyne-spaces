import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class CallsACL extends BaseACL<'calls'> {
  async canInsert(args: InsertValue<TableSchema<'calls'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
    if (!channel) {
      throw new MutationACLError('Call insert failed: the specified channel does not exist', 'calls');
    }

    if (channel.isArchived) {
      throw new MutationACLError('Call insert failed: cannot start calls in archived channel', 'calls');
    }

    const isParticipant = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (!isParticipant) {
      throw new MutationACLError('Call insert failed: you must be a channel participant to start calls', 'calls');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'calls'>>, tx: Transaction<Schema>): Promise<void> {
    const callInfo = await tx.run(zql.calls.where('id', args.id).related('channel').one());
    if (!callInfo || !callInfo.channel) {
      throw new MutationACLError('Call update failed: call does not exist', 'calls');
    }

    if (callInfo.channel.isArchived) {
      throw new MutationACLError('Call update failed: cannot update calls in archived channel', 'calls');
    }

    if (args.status || args.endedAt || args.updatedAt) {
      const isParticipant = await tx.run(zql.call_participants
        .where('callId', args.id)
        .where('userId', this.ctx.userID)
        .one());
      if (!isParticipant) {
        throw new MutationACLError('Call update failed: only call participants can update call status', 'calls');
      }
      return;
    }
    if (callInfo.createdByUserId !== this.ctx.userID) {
      throw new MutationACLError('Call update failed: only the call creator can modify call details', 'calls');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'calls'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Call delete failed: call records cannot be deleted once created', 'calls')
  }
}
