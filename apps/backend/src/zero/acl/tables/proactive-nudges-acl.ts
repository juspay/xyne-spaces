import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ChannelVisibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

const allowedUpdateFields = new Set([
  'id',
  'state',
  'actions',
]);

export class ProactiveNudgesACL extends BaseACL<'proactive_nudges'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Proactive nudge not found: channel does not exist', 'proactive_nudges');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Proactive nudge not found in this workspace', 'proactive_nudges');
    }
  }

  async canInsert(_args: InsertValue<TableSchema<'proactive_nudges'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Proactive nudge insert failed: nudges are system-managed', 'proactive_nudges');
  }

  async canUpdate(args: UpdateValue<TableSchema<'proactive_nudges'>>, tx: Transaction<Schema>): Promise<void> {
    const invalidFields = Object.keys(args).filter(
      (key) => (args as Record<string, unknown>)[key] !== undefined && !allowedUpdateFields.has(key)
    );

    if (invalidFields.length > 0) {
      throw new MutationACLError(
        `Proactive nudge update failed: invalid fields [${invalidFields.join(', ')}]`,
        'proactive_nudges'
      );
    }

    const nudge = await tx.run(zql.proactive_nudges.where('id', args.id).one());
    if (!nudge) {
      throw new MutationACLError('Proactive nudge update failed: nudge does not exist', 'proactive_nudges');
    }

    const message = await tx.run(zql.messages.where('messageId', nudge.messageId).one());
    if (!message) {
      throw new MutationACLError('Proactive nudge update failed: message not found', 'proactive_nudges');
    }
    if (message.visibleTo && message.visibleTo !== this.ctx.userID) {
      throw new MutationACLError('Proactive nudge update failed: message not visible to user', 'proactive_nudges');
    }

    const conversation = await tx.run(
      zql.conversations
        .where('conversationId', message.conversationId)
        .related('channel')
        .one()
    );

    if (!conversation || !conversation.channel) {
      throw new MutationACLError('Proactive nudge update failed: conversation not found', 'proactive_nudges');
    }
    await this.verifyChannelInWorkspace(conversation.channel.id, tx);

    if (conversation.channel.visibility !== ChannelVisibility.PUBLIC) {
      const participant = await tx.run(
        zql.channel_participants
          .where('channelId', conversation.channel.id)
          .where('userId', this.ctx.userID)
          .one()
      );

      if (!participant) {
        throw new MutationACLError('Proactive nudge update failed: user not in channel', 'proactive_nudges');
      }
    }

  }

  async canDelete(_args: DeleteID<TableSchema<'proactive_nudges'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Proactive nudge delete failed: nudges are system-managed', 'proactive_nudges');
  }
}
