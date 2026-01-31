import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ConversationParticipantsACL extends BaseACL<'conversation_participants'> {

  async canInsert(args: InsertValue<TableSchema<'conversation_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx
      .run(
      zql.conversations
      .where('conversationId', args.conversationId)
      .related('channel')
      .one());

    if (!channel) {
      throw new MutationACLError('Conversation participant insert failed: the conversation or its channel does not exist', 'conversation_participants')
    }

    const isParticipant = await tx
      .run(
      zql.channel_participants
      .where('userId', this.ctx.userID)
      .where('channelId', channel.channelId)
      .one());

    if (!isParticipant) {
      throw new MutationACLError('Conversation participant insert failed: only channel participants can join conversations', 'conversation_participants')
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversation_participants'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.conversationId) {
      throw new MutationACLError('Conversation participant update failed: conversationId is an immutable field', 'conversation_participants')
    }
    const participantInfo = await tx
      .run(
      zql.conversation_participants
      .where('id', args.id)
      .one());
    
    if (participantInfo?.userId != this.ctx.userID) {
      throw new MutationACLError('Conversation participant update failed: you can only modify your own participant details', 'conversation_participants')
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'conversation_participants'>>, _tx: Transaction<Schema>): Promise<void> {
    // Need to think about rules for deleting conversation participants since mention/sender logic needs to be improved.
  }
}
