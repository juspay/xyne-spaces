import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, MessageType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';

export class MessagesACL extends BaseACL<'messages'> {

  private async verifyConversationInWorkspace(conversationId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const conversationWorkspaceId = workspaceId ?? await tx.run(zql.conversations.where('conversationId', conversationId).related('channel').one()).then(c => c?.channel?.workspaceId);
    if (!conversationWorkspaceId) throw new MutationACLError('Message not found: conversation does not exist', 'messages');
    if (conversationWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message not found in this workspace', 'messages');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'messages'>>, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', '=', args.conversationId).related('channel').one());
    if (!conversation || !conversation.channel) {
      throw new MutationACLError('Message insert failed: conversation or channel does not exist', 'messages');
    }
    if (conversation.channel.isArchived) {
      throw new MutationACLError('Message insert failed: cannot send messages in archived channel', 'messages');
    }
    await this.verifyConversationInWorkspace(args.conversationId, tx, conversation.channel.workspaceId);

    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasChannelMutationAccess(this.ctx, tx, conversation.channel.id, {
        allowPublicForNonGuests: true,
      });
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError('Message insert failed: guest does not have access to this channel', 'messages');
    }

    if (conversation.channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }

    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', '=', conversation.channel.id)
        .where('userId', '=', this.ctx.userID)
        .one(),
    );
    if (participant) {
      return;
    }

    throw new MutationACLError('Message insert failed: only channel participants can send messages in private channels', 'messages');
  }

  async canUpdate(args: UpdateValue<TableSchema<'messages'>>, tx: Transaction<Schema>): Promise<void> {
    const message = await tx.run(zql.messages.where('messageId', '=', args.messageId).one());
    if (!message) {
      throw new MutationACLError('Message update failed: message does not exist', 'messages');
    }
    await this.verifyConversationInWorkspace(message.conversationId, tx);
    if (message.senderId === this.ctx.userID || message.msgType === MessageType.SYSTEM) {
      return;
    }
    throw new MutationACLError('Message update failed: only the original sender can edit this message', 'messages');
  }

  async canDelete(args: DeleteID<TableSchema<'messages'>>, tx: Transaction<Schema>): Promise<void> {
    const message = await tx.run(zql.messages.where('messageId', '=', args.messageId).one());
    if (!message) {
      throw new MutationACLError('Message delete failed: message does not exist', 'messages');
    }
    await this.verifyConversationInWorkspace(message.conversationId, tx);
    if (message.senderId === this.ctx.userID || message.msgType === MessageType.SYSTEM) {
      return;
    }

    const conversation = await tx.run(
      zql.conversations.where('conversationId', message.conversationId).one(),
    );

    // When the initial message of a thread is deleted while replies still exist,
    // the message is kept as a tombstone so the thread remains visible. Deleting
    // the final reply later needs to remove that tombstone and then the empty
    // conversation. Allow that cleanup only when this message is the deleted
    // initial message and there are no other messages left in the conversation.
    // This keeps the normal "only sender can delete" rule for live messages and
    // for tombstones that still anchor visible replies.
    if (conversation?.initialMessageId === message.messageId && message.isDeleted) {
      const remainingMessages = await tx.run(
        zql.messages.where('conversationId', message.conversationId),
      );
      const hasOtherMessages = remainingMessages.some(
        remainingMessage => remainingMessage.messageId !== message.messageId,
      );

      if (!hasOtherMessages) {
        return;
      }
    }

    throw new MutationACLError('Message delete failed: only the original sender can delete this message', 'messages');
  }
}
