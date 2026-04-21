import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ChannelVisibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

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

    const channelParticipant = await tx.run(zql.channel_participants
      .where('channelId', args.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (channel?.visibility === ChannelVisibility.PUBLIC ||
        channelParticipant ) {
      return;
    }
    throw new MutationACLError('Conversation insert failed: you must be a channel participant or the channel must be public', 'conversations');
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyConversationInWorkspace(args.conversationId, tx);
    if (args.channelId || args.createdBy) {
      throw new MutationACLError('Conversation update failed: channelId and createdBy are immutable fields', 'conversations')
    }
    return
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
    throw new MutationACLError('Conversation delete failed: only the conversation creator can delete it', 'conversations');
  }
}
