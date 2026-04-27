import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class DelayedMessagesACL extends BaseACL<'delayed_messages'> {
  private async verifyChannelInWorkspace(
    channelId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const channel = (await tx.run(zql.channels.where('id', channelId).one()));
    if (!channel) {
      throw new MutationACLError('Scheduled message: channel does not exist', 'delayed_messages');
    }
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Scheduled message: channel is not in this workspace', 'delayed_messages');
    }
  }

  private async ensureChannelAllowsScheduling(
    channelId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) {
      throw new MutationACLError('Scheduled message: channel does not exist', 'delayed_messages');
    }
    await this.verifyChannelInWorkspace(channelId, tx);
    if (channel.isArchived) {
      throw new MutationACLError('Scheduled message: channel is archived', 'delayed_messages');
    }
    if (channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }
    const participant = await tx.run(
      zql.channel_participants.where('channelId', channelId).where('userId', this.ctx.userID).one(),
    );
    if (!participant) {
      throw new MutationACLError(
        'Scheduled message: only channel participants can schedule in this channel',
        'delayed_messages',
      );
    }
  }

  async canInsert(args: InsertValue<TableSchema<'delayed_messages'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.senderId !== this.ctx.userID) {
      throw new MutationACLError('Scheduled message insert failed: invalid sender', 'delayed_messages');
    }
    await this.ensureChannelAllowsScheduling(args.channelId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'delayed_messages'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.delayed_messages.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Scheduled message update failed: not found', 'delayed_messages');
    }
    await this.verifyChannelInWorkspace(row.channelId, tx);
    if (row.senderId !== this.ctx.userID) {
      throw new MutationACLError('Scheduled message update failed: not authorized', 'delayed_messages');
    }
    if (args.senderId !== undefined && args.senderId !== this.ctx.userID) {
      throw new MutationACLError('Scheduled message update failed: cannot change sender', 'delayed_messages');
    }
    if (args.channelId !== undefined && args.channelId !== row.channelId) {
      await this.ensureChannelAllowsScheduling(args.channelId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'delayed_messages'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.delayed_messages.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Scheduled message delete failed: not found', 'delayed_messages');
    }
    await this.verifyChannelInWorkspace(row.channelId, tx);
    if (row.senderId !== this.ctx.userID) {
      throw new MutationACLError('Scheduled message delete failed: not authorized', 'delayed_messages');
    }
  }
}
