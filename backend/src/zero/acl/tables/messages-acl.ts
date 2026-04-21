import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, MessageType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

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
    if (conversation.channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }

    const participant = await tx.run(zql.channel_participants
      .where('channelId', '=', conversation.channel.id)
      .where('userId', '=', this.ctx.userID)
      .one());

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
    throw new MutationACLError('Message delete failed: only the original sender can delete this message', 'messages');
  }
}
