import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';

export class ConversationParticipantsACL extends BaseACL<'conversation_participants'> {

  private async verifyConversationInWorkspace(conversationId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const conversationWorkspaceId = workspaceId ?? await tx.run(zql.conversations.where('conversationId', conversationId).related('channel').one()).then(c => c?.channel?.workspaceId);
    if (!conversationWorkspaceId) throw new MutationACLError('Conversation participant not found: conversation does not exist', 'conversation_participants');
    if (conversationWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Conversation participant not found in this workspace', 'conversation_participants');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'conversation_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', args.conversationId).related('channel').one());

    if (!conversation) {
      throw new MutationACLError('Conversation participant insert failed: the conversation does not exist', 'conversation_participants')
    }
    await this.verifyConversationInWorkspace(args.conversationId, tx, conversation.channel?.workspaceId);

    if (conversation.channel?.isArchived) {
      throw new MutationACLError('Conversation participant insert failed: cannot join conversations in archived channel', 'conversation_participants')
    }

    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasChannelMutationAccess(this.ctx, tx, conversation.channelId, {
        allowPublicForNonGuests: true,
      });
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Conversation participant insert failed: guest does not have access to this channel', 'conversation_participants')
    }

    const isParticipant = await tx.run(
      zql.channel_participants
        .where('userId', this.ctx.userID)
        .where('channelId', conversation.channelId)
        .one(),
    );

    if (!isParticipant && conversation.channel?.visibility !== 'PUBLIC') {
      throw new MutationACLError('Conversation participant insert failed: only channel participants can join conversations in private channels', 'conversation_participants')
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversation_participants'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.conversationId) {
      throw new MutationACLError('Conversation participant update failed: conversationId is an immutable field', 'conversation_participants')
    }
    const participantInfo = await tx
      .run(
      zql.conversation_participants
      .where('id', args.id)
      .one());

    // Allow updating denormalized system fields (lastReplyAt, channelId) on any
    // participant row if the updater is a channel member. These fields are synced
    // by the system when replies are sent, not user-controlled. Also allow
    // updating subscription/participation type when users are mentioned.
    const isSystemFieldUpdate = Object.keys(args).every(
      k => ['id', 'lastReplyAt', 'channelId', 'participationType', 'isSubscribed', 'joinedAt'].includes(k)
    );

    if (!isSystemFieldUpdate && participantInfo?.userId != this.ctx.userID) {
      throw new MutationACLError('Conversation participant update failed: you can only modify your own participant details', 'conversation_participants')
    }
    if (participantInfo) {
      await this.verifyConversationInWorkspace(participantInfo.conversationId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'conversation_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.conversation_participants.where('id', args.id).one());
    if (!participant) {
      throw new MutationACLError('Conversation participant delete failed: the participant does not exist', 'conversation_participants')
    }
    // The row's own channelId is denormalized and nullable, so take the channel from the
    // conversation, which always has one.
    const conversation = await tx.run(
      zql.conversations.where('conversationId', participant.conversationId).related('channel').one(),
    );
    await this.verifyConversationInWorkspace(
      participant.conversationId,
      tx,
      conversation?.channel?.workspaceId,
    );

    // Leaving is always yours to do. Removing someone else is the sender and mention
    // bookkeeping, which runs on behalf of people already in the channel — the same
    // audience canUpdate lets touch another row's system fields.
    if (participant.userId === this.ctx.userID) {
      return;
    }

    const isChannelParticipant = await tx.run(
      zql.channel_participants
        .where('userId', this.ctx.userID)
        .where('channelId', conversation!.channelId)
        .one(),
    );

    if (!isChannelParticipant) {
      throw new MutationACLError('Conversation participant delete failed: only channel participants can remove others', 'conversation_participants')
    }
  }
}
