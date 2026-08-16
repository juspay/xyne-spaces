import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ChannelVisibility } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { nudgeRegistry } from '@/nudges/registry';

const allowedUpdateFields = new Set([
  'id',
  'state',
  'actions',
  'updatedAt',
  'surfaceNudgeCountId',
]);

export class SurfaceNudgesACL extends BaseACL<'surface_nudges'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) throw new MutationACLError('Surface nudge not found: channel does not exist', 'surface_nudges');
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Surface nudge not found in this workspace', 'surface_nudges');
    }
  }

  async canInsert(_args: InsertValue<TableSchema<'surface_nudges'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Surface nudge insert failed: nudges are system-managed', 'surface_nudges');
  }

  async canUpdate(args: UpdateValue<TableSchema<'surface_nudges'>>, tx: Transaction<Schema>): Promise<void> {
    const invalidFields = Object.keys(args).filter(
      (key) => (args as Record<string, unknown>)[key] !== undefined && !allowedUpdateFields.has(key)
    );

    if (invalidFields.length > 0) {
      throw new MutationACLError(
        `Surface nudge update failed: invalid fields [${invalidFields.join(', ')}]`,
        'surface_nudges'
      );
    }

    const nudge = await tx.run(zql.surface_nudges.where('id', args.id).one());
    if (!nudge) {
      throw new MutationACLError('Surface nudge update failed: nudge does not exist', 'surface_nudges');
    }

    // Enforce visibleTo ownership: if set, only that user can update the nudge
    if (nudge.visibleTo && nudge.visibleTo !== this.ctx.userID) {
      throw new MutationACLError('Surface nudge update failed: nudge not visible to user', 'surface_nudges');
    }

    // For message-source nudges, verify message visibility and channel access
    const definition = nudgeRegistry.getByKind(nudge.nudgeKind as string);
    if (definition && definition.direction.from === 'MESSAGE') {
      const message = await tx.run(zql.messages.where('messageId', nudge.sourceId).one());
      if (!message) {
        throw new MutationACLError('Surface nudge update failed: source message not found', 'surface_nudges');
      }
      if (message.visibleTo && message.visibleTo !== this.ctx.userID) {
        throw new MutationACLError('Surface nudge update failed: message not visible to user', 'surface_nudges');
      }

      const conversation = await tx.run(
        zql.conversations
          .where('conversationId', message.conversationId)
          .related('channel')
          .one()
      );

      if (!conversation || !conversation.channel) {
        throw new MutationACLError('Surface nudge update failed: conversation not found', 'surface_nudges');
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
          throw new MutationACLError('Surface nudge update failed: user not in channel', 'surface_nudges');
        }
      }
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'surface_nudges'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Surface nudge delete failed: nudges are system-managed', 'surface_nudges');
  }
}
