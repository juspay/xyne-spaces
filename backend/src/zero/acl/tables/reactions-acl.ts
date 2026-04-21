import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ReactionsACL extends BaseACL<'reactions'> {

  private async verifyConversationInWorkspace(conversationId: string, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', conversationId).one());
    if (!conversation) throw new MutationACLError('Reaction not found: conversation does not exist', 'reactions');
    const channel = await tx.run(zql.channels.where('id', conversation.channelId).one());
    if (channel?.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Reaction not found in this workspace', 'reactions');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'reactions'>>, tx: Transaction<Schema>): Promise<void> {
    const message = await tx.run(zql.messages.where('messageId', args.messageId).related('conversation').one());
    if (!message || !message.conversation) {
      throw new MutationACLError('Reaction insert failed: the specified message or its conversation does not exist', 'reactions');
    }

    const channel = await tx.run(zql.channels.where('id', message.conversation.channelId).one());
    if (!channel) {
      throw new MutationACLError('Reaction insert failed: the channel does not exist', 'reactions');
    }
    await this.verifyConversationInWorkspace(message.conversation.conversationId, tx);

    if (channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }

    const currentUserParticipantData = await tx.run(zql.channel_participants.where('channelId', channel.id).where('userId', this.ctx.userID).one());

    if (!currentUserParticipantData) {
      throw new MutationACLError('Reaction insert failed: you must be a channel participant to react to messages in private channels', 'reactions');
    }

  }

  async canUpdate(args: UpdateValue<TableSchema<'reactions'>>, tx: Transaction<Schema>): Promise<void> {
    const reaction = await tx.run(zql.reactions.where('reactionId', args.reactionId).where('userId', this.ctx.userID).one());
    if (!reaction) {
      throw new MutationACLError('Reaction update failed: you can only modify your own reactions', 'reactions');
    }
    const message = await tx.run(zql.messages.where('messageId', reaction.messageId).related('conversation').one());
    if (message?.conversation) {
      await this.verifyConversationInWorkspace(message.conversation.conversationId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'reactions'>>, tx: Transaction<Schema>): Promise<void> {
    const reaction = await tx.run(zql.reactions.where('reactionId', args.reactionId).one());
    if (!reaction) {
      throw new MutationACLError("Reaction not found", "reactions")
    }
    const messageWithConversation = await tx.run(zql.messages.where('messageId', reaction.messageId).related('conversation').one());
    if (messageWithConversation?.conversation) {
      await this.verifyConversationInWorkspace(messageWithConversation.conversation.conversationId, tx);
    }
    if (reaction.userId === this.ctx.userID) {
      return
    }
    if (messageWithConversation?.senderId === this.ctx.userID) {
      return
    }

    throw new MutationACLError("Only message owner or reaction owner can delete this reaction", "reactions")
  }
}
