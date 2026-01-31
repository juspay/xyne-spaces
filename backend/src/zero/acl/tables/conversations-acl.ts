import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ChannelVisibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ConversationsACL extends BaseACL<'conversations'> {

  async canInsert(args: InsertValue<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
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

  async canUpdate(args: UpdateValue<TableSchema<'conversations'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.channelId || args.createdBy) {
      throw new MutationACLError('Conversation update failed: channelId and createdBy are immutable fields', 'conversations')
    }
    return 
  }

  async canDelete(args: DeleteID<TableSchema<'conversations'>>, tx: Transaction<Schema>): Promise<void> {
    const conversation = await tx.run(zql.conversations.where('conversationId', args.conversationId).one());
    // conversation?.createdBy === 'user' -> This is a hack since system messages currenthave user as createBy. Need to fix the core issue
    if (conversation?.createdBy === this.ctx.userID || conversation?.createdBy === 'user') {
      return;
    }
    throw new MutationACLError('Conversation delete failed: only the conversation creator can delete it', 'conversations');
  }
}
