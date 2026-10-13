import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ChannelVisibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';

export class ConversationsACL extends BaseACL<'conversations'> {

  private async verifyConversationInWorkspace(conversationId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const conversationWorkspaceId = workspaceId ?? await tx.run(zql.conversations.where('conversationId', conversationId).related('channel').one()).then(c => c?.channel?.workspaceId);
    if (!conversationWorkspaceId) throw new MutationACLError('Conversation not found', 'conversations');
    if (conversationWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Conversation not found in this workspace', 'conversations');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
    if (!channel) throw new MutationACLError('Conversation not found: channel does not exist', 'conversations');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Conversation not found in this workspace', 'conversations');
    }


    if (channel?.isArchived) {
      throw new MutationACLError('Conversation insert failed: cannot create conversations in archived channel', 'conversations');
    }

    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasChannelMutationAccess(this.ctx, tx, args.channelId, {
        allowPublicForNonGuests: true,
      });
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Conversation insert failed: guest does not have access to this channel', 'conversations');
    }

    const channelParticipant = await tx.run(
      zql.channel_participants
        .where('channelId', args.channelId)
        .where('userId', this.ctx.userID)
        .one(),
    );

    if (channel.visibility === ChannelVisibility.PUBLIC || channelParticipant) {
      return;
    }
    throw new MutationACLError('Conversation insert failed: you must be a channel participant or the channel must be public', 'conversations');
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyConversationInWorkspace(args.conversationId, tx);
    if (args.channelId || args.createdBy) {
      throw new MutationACLError('Conversation update failed: channelId and createdBy are immutable fields', 'conversations')
    }

    const conversation = await tx.run(zql.conversations.where('conversationId', args.conversationId).related('channel').one());
    if (!conversation || !conversation.channel) {
      throw new MutationACLError('Conversation update failed: conversation does not exist', 'conversations');
    }

    const channelParticipant = await tx.run(zql.channel_participants
      .where('channelId', conversation.channel.id)
      .where('userId', this.ctx.userID)
      .one());

    if (conversation.channel.visibility === ChannelVisibility.PUBLIC || channelParticipant) {
      return;
    }
    throw new MutationACLError('Conversation update failed: you must be a channel participant to update this conversation', 'conversations');
  }

  async canDelete(args: DeleteID<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', args.conversationId).related('channel').one());
    if (!conversation) {
      throw new MutationACLError('Conversation delete failed: conversation does not exist', 'conversations');
    }

    if (conversation.channel?.isArchived) {
      throw new MutationACLError('Conversation delete failed: cannot delete conversations in archived channel', 'conversations');
    }

    if (conversation) {
      await this.verifyConversationInWorkspace(conversation.conversationId, tx);
    }
    // conversation?.createdBy === 'user' -> This is a hack since system messages currenthave user as createBy. Need to fix the core issue
    if (conversation.createdBy === this.ctx.userID || conversation.createdBy === 'user') {
      return;
    }

    // Message deletion can legitimately remove the last visible reply from a
    // thread whose initial message was already tombstoned. By the time the
    // mutator deletes the conversation, all messages have been removed. Allow
    // that empty-thread cleanup without giving users permission to delete
    // conversations that still contain messages owned by others.
    const remainingMessages = await tx.run(
      zql.messages.where('conversationId', conversation.conversationId),
    );
    if (remainingMessages.length === 0) {
      return;
    }

    throw new MutationACLError('Conversation delete failed: only the conversation creator can delete it', 'conversations');
  }
}
