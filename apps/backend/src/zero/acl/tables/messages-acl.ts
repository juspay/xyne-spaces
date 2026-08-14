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

  private async assertChannelMembership(conversationId: string, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', '=', conversationId).related('channel').one());
    if (!conversation || !conversation.channel) {
      throw new MutationACLError('Message not found: conversation or channel does not exist', 'messages');
    }
    if (conversation.channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }
    const participant = await tx.run(zql.channel_participants
      .where('channelId', '=', conversation.channel.id)
      .where('userId', '=', this.ctx.userID)
      .one());
    if (!participant) {
      throw new MutationACLError('Message mutation failed: only channel participants can modify messages in private channels', 'messages');
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

    // A run of participant changes by one admin coalesces into a single notice rather than
    // posting one per person, so that notice is edited after it is written. Only its own
    // author may do so, and only in a channel they belong to — every other system message
    // stays as posted.
    if (message.msgType === MessageType.SYSTEM) {
      const meta = message.metadata as { operationType?: string; adminUserId?: string } | null;
      const isParticipantNotice =
        meta?.operationType === 'participants_added' ||
        meta?.operationType === 'participants_removed' ||
        meta?.operationType === 'participants_joined';

      if (!isParticipantNotice || meta?.adminUserId !== this.ctx.userID) {
        throw new MutationACLError('Message update failed: system messages cannot be modified', 'messages');
      }
      await this.assertChannelMembership(message.conversationId, tx);
      return;
    }
    if (message.senderId !== this.ctx.userID) {
      throw new MutationACLError('Message update failed: only the original sender can edit this message', 'messages');
    }
    await this.assertChannelMembership(message.conversationId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'messages'>>, tx: Transaction<Schema>): Promise<void> {
    const message = await tx.run(zql.messages.where('messageId', '=', args.messageId).one());
    if (!message) {
      throw new MutationACLError('Message delete failed: message does not exist', 'messages');
    }
    await this.verifyConversationInWorkspace(message.conversationId, tx);

    // A system message carrying `visibleTo` was addressed to one person, so dismissing it is
    // theirs to do. One left unset was posted to the channel — call summaries, release
    // notes, commit reports — and belongs to everyone, so nobody deletes it.
    //
    // Keyed on who it is addressed to rather than a list of subtypes: a new personal notice
    // then works without touching this file, and a new channel-wide one is refused by
    // default rather than by remembering to add it.
    if (message.msgType === MessageType.SYSTEM) {
      if (message.visibleTo === this.ctx.userID) {
        return;
      }
      throw new MutationACLError('Message delete failed: system messages cannot be deleted', 'messages');
    }

    if (message.senderId !== this.ctx.userID) {
      throw new MutationACLError('Message delete failed: only the original sender can delete this message', 'messages');
    }
    await this.assertChannelMembership(message.conversationId, tx);
  }
}
