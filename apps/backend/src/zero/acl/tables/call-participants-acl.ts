import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';
export class CallParticipantsACL extends BaseACL<'call_participants'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Call participant not found: channel does not exist', 'call_participants');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Call participant not found in this workspace', 'call_participants');
    }
  }

  private async isChannelParticipant(channelId: string, userId: string, tx: Transaction<Schema>): Promise<boolean> {
    const row = await tx.run(zql.channel_participants
      .where('channelId', channelId)
      .where('userId', userId)
      .one());
    return !!row;
  }

  // The caller may add themselves to a call they can access (self-join), but
  // inviting another user requires the caller to be the call creator or an
  // existing call participant.
  private async verifyCallerMayInvite(callId: string, createdByUserId: string, invitedUserId: string, tx: Transaction<Schema>): Promise<void> {
    if (invitedUserId === this.ctx.userID) return;
    if (createdByUserId === this.ctx.userID) return;
    const callerParticipant = await tx.run(zql.call_participants
      .where('callId', callId)
      .where('userId', this.ctx.userID)
      .one());
    if (!callerParticipant) {
      throw new MutationACLError('Call participant insert failed: only the call creator or an existing participant can invite others', 'call_participants');
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
    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasChannelMutationAccess(this.ctx, tx, callData.channel.id, {
        allowPublicForNonGuests: true,
      });
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Call participant insert failed: guest does not have access to this channel', 'call_participants');
    }

    // The invited user (args.userId), not just the caller, must be a
    // participant of the call's channel.
    if (!(await this.isChannelParticipant(callData.channel.id, args.userId, tx))) {
      throw new MutationACLError('Call participant insert failed: the invited user must be a participant of the call\'s channel', 'call_participants');
    }

    await this.verifyCallerMayInvite(callData.id, callData.createdByUserId, args.userId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    // The re-invite path (call.invite on an existing row): load the row and apply
    // the same workspace + caller-authority gate as insert.
    const row = await tx.run(zql.call_participants.where('id', args.id).related('call').one());
    if (!row || !row.call || !row.call.channelId) {
      throw new MutationACLError('Call participant update failed: participant record does not exist', 'call_participants');
    }
    await this.verifyChannelInWorkspace(row.call.channelId, tx);
    await this.verifyCallerMayInvite(row.callId, row.call.createdByUserId, row.userId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'call_participants'>>, tx: Transaction<Schema>): Promise<void> {
    // Removing a participant: load the row and apply the same workspace + caller-authority
    // gate as update/insert (self-leave, or the call creator/an existing participant).
    const row = await tx.run(zql.call_participants.where('id', args.id).related('call').one());
    if (!row || !row.call || !row.call.channelId) {
      throw new MutationACLError('Call participant delete failed: participant record does not exist', 'call_participants');
    }
    await this.verifyChannelInWorkspace(row.call.channelId, tx);
    await this.verifyCallerMayInvite(row.callId, row.call.createdByUserId, row.userId, tx);
  }

}
