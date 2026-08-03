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

    // Classification is shared metadata, not content: anyone who can READ a message may
    // tag it, the same way anyone can react to it. Author-only would mean you could not
    // tag a colleague's message, while the classifier tags everyone's — inconsistent.
    //
    // Narrow on purpose: allowed only when messageActs is the sole field being changed,
    // so this cannot become a route for editing someone else's content. And gated on
    // actual visibility, because verifyConversationInWorkspace above only checks the
    // workspace — without this, anyone in the workspace could tag a message inside a
    // private channel they are not in, or one targeted at someone else via visibleTo.
    const changedFields = Object.keys(args).filter(field => field !== 'messageId');
    const isAuthorOrSystem =
      message.senderId === this.ctx.userID || message.msgType === MessageType.SYSTEM;

    // Any update touching messageActs needs channel admin — checked on the FIELD, not on
    // the update being acts-only. Otherwise an author could bundle acts into a content
    // edit ({ content, edited, messageActs }) and write them without being an admin.
    if (changedFields.includes('messageActs')) {
      await this.verifyChannelAdminCanTag(args.messageId, tx);

      // Acts alone are a channel-admin action. Anything bundled alongside is still an
      // edit of the message itself, so the author rule continues to apply to it.
      if (changedFields.length > 1 && !isAuthorOrSystem) {
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
   * Only a channel ADMIN may hand-edit a message's classification.
   *
   * Scoped to the channel rather than the org: acts describe what happened in this
   * conversation, so the people who run this channel are the right editors — an org admin
   * with no involvement here is not, and a member shouldn't be relabelling colleagues'
   * messages. Classification is shared, team-visible metadata, so it is not the author's
   * to control either.
   *
   * The classifier is unaffected: it writes through Prisma, bypassing this layer entirely.
   * So AI tags everything and admins correct it.
   *
   * Membership is also the visibility check — you cannot be a channel admin of a channel
   * you are not in. Only visibleTo needs testing separately, since a targeted message
   * inside an admin's own channel may still not be theirs to read.
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
