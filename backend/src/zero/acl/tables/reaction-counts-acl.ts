import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ReactionCountsACL extends BaseACL<'reaction_counts'> {

  async canInsert(args: InsertValue<TableSchema<'reaction_counts'>>, tx: Transaction<Schema>): Promise<void> {
    const message = await tx.run(zql.messages.where('messageId', args.messageId).related('conversation').one());
    if (!message || !message.conversation) {
      throw new MutationACLError('Reaction count insert failed: the specified message or its conversation does not exist', 'reaction_counts');
    }

    const channel = await tx.run(zql.channels.where('id', message.conversation.channelId).one());
    const channelParticipant = await tx.run(zql.channel_participants
      .where('channelId', message.conversation.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (channel?.visibility === ChannelVisibility.PUBLIC ||
        channelParticipant ) {
      return;
    }
    throw new MutationACLError('Reaction count insert failed: you must be a channel participant to react to messages in private channels', 'reaction_counts');
  }

  async canUpdate(args: UpdateValue<TableSchema<'reaction_counts'>>, tx: Transaction<Schema>): Promise<void> {
    const countWithMessage = await tx.run(zql.reaction_counts.where('countId', '=', args.countId).related('message', (message) =>  message.related('conversation')).one());
    if (!countWithMessage || !countWithMessage.message || !countWithMessage.message.conversation) {
      throw new MutationACLError('Reaction count update failed: the reaction count or its message does not exist', 'reaction_counts');
    }

    const channel = await tx.run(zql.channels.where('id', countWithMessage.message.conversation.channelId).one());
    const channelParticipant = await tx.run(zql.channel_participants
      .where('channelId', countWithMessage.message.conversation.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (channel?.visibility === ChannelVisibility.PUBLIC ||
        channelParticipant ) {
      return;
    }
    throw new MutationACLError('Reaction count update failed: you must be a channel participant to modify reactions in private channels', 'reaction_counts');
  }

  async canDelete(args: DeleteID<TableSchema<'reaction_counts'>>, tx: Transaction<Schema>): Promise<void> {
    const countWithMessage = await tx.run(zql.reaction_counts.where('countId', '=', args.countId).related('message', (message) => message.related('conversation')).one());
    if (!countWithMessage || !countWithMessage.message || !countWithMessage.message.conversation) {
      throw new MutationACLError('Reaction count delete failed: the reaction count or its message does not exist', 'reaction_counts');
    }

    const channel = await tx.run(zql.channels.where('id', countWithMessage.message.conversation.channelId).one());
    const channelParticipant = await tx.run(zql.channel_participants
      .where('channelId', countWithMessage.message.conversation.channelId)
      .where('userId', this.ctx.userID)
      .one());

    if (channel?.visibility === ChannelVisibility.PUBLIC || channelParticipant) {
      return;
    }
    throw new MutationACLError('Reaction count delete failed: you must be a channel participant to delete reactions in private channels', 'reaction_counts');
  }
}
