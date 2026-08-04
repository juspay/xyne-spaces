import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, ChannelVisibility, MessageType, Schema } from '@xyne/shared';
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

    const changedFields = Object.keys(args).filter(field => field !== 'messageId');
    const isAuthorOrSystem =
      message.senderId === this.ctx.userID || message.msgType === MessageType.SYSTEM;

    // Keyed on the field, not on the update being acts-only, so acts cannot ride along in
    // a content edit and skip the admin check below.
    if (changedFields.includes('messageActs')) {
      if (isAuthorOrSystem) {
        return;
      }

      await this.verifyChannelAdminCanTag(args.messageId, tx);
      // An admin may relabel a colleague's message, not rewrite it.
      if (changedFields.length > 1) {
        throw new MutationACLError(
          'Message update failed: only the original sender can edit this message',
          'messages',
        );
      }
      return;
    }

    if (isAuthorOrSystem) {
      return;
    }
    throw new MutationACLError('Message update failed: only the original sender can edit this message', 'messages');
  }

  /**
   * Who, other than the sender, may tag a message: a channel ADMIN.
   *
   * Membership doubles as the visibility check — you cannot be admin of a channel you are
   * not in — so only visibleTo needs testing separately.
   */
  private async verifyChannelAdminCanTag(messageId: string, tx: Transaction<Schema>): Promise<void> {
    const allowed = await tx.run(
      zql.messages
        .where('messageId', messageId)
        .where(({ or, cmp }) => or(cmp('visibleTo', 'IS', null), cmp('visibleTo', this.ctx.userID)))
        .whereExists('conversation', conversation =>
          conversation.whereExists('channel', channel =>
            channel
              .where('workspaceId', '=', this.ctx.workspaceId)
              .whereExists('participants', participant =>
                participant.where('userId', this.ctx.userID).where('role', ChannelRole.ADMIN),
              ),
          ),
        )
        .one(),
    );

    if (!allowed) {
      throw new MutationACLError(
        'Message update failed: only a channel admin can change message tags',
        'messages',
      );
    }
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
