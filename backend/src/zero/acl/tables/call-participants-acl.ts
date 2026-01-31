import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
export class CallParticipantsACL extends BaseACL<'call_participants'> {

  async canInsert(args: InsertValue<TableSchema<'call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const callData = await tx.run(zql.calls.where('id', args.callId).related('channel').one());
    if (!callData || !callData.channel) {
      throw new MutationACLError('Call participant insert failed: the specified call or its channel does not exist', 'call_participants');
    }
    const isParticipant = await tx.run(zql.channel_participants
      .where('channelId', callData.channel.id)
      .where('userId', this.ctx.userID)
      .one());

    if (!isParticipant) {
      throw new MutationACLError('Call participant insert failed: you must be a channel participant to join calls', 'call_participants');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'call_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    // const callParticipantInfo = await tx.query.call_participants.where('id', args.id).one().run();
    // if (!callParticipantInfo) {
    //   throw new MutationACLError('Call participant update failed: participant record does not exist', 'call_participants');
    // }

    // if (callParticipantInfo.userId !== this.ctx.userID) {
    //   throw new MutationACLError('Call participant update failed: you can only update your own participant info', 'call_participants');
    // }

  }

  async canDelete(_args: DeleteID<TableSchema<'call_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Call participant delete failed: call participant records cannot be deleted', 'call_participants');
  }
}
