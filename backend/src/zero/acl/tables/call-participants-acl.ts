import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
export class CallParticipantsACL extends BaseACL<'call_participants'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Call participant not found: channel does not exist', 'call_participants');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Call participant not found in this workspace', 'call_participants');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const callData = await tx.run(zql.calls.where('id', args.callId).related('channel').one());
    if (!callData || !callData.channel) {
      throw new MutationACLError('Call participant insert failed: the specified call or its channel does not exist', 'call_participants');
    }

    if (callData.channel.isArchived) {
      throw new MutationACLError('Call participant insert failed: cannot join calls in archived channel', 'call_participants');
    }

    await this.verifyChannelInWorkspace(callData.channel.id, tx);
    const isParticipant = await tx.run(zql.channel_participants
      .where('channelId', callData.channel.id)
      .where('userId', this.ctx.userID)
      .one());

    if (!isParticipant) {
      throw new MutationACLError('Call participant insert failed: you must be a channel participant to join calls', 'call_participants');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'call_participants'>>, _tx: Transaction<Schema>): Promise<void> {

  }

  async canDelete(_args: DeleteID<TableSchema<'call_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Call participant delete failed: call participant records cannot be deleted', 'call_participants');
  }
}
