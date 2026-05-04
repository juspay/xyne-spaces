import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class EmailChannelPreferencesACL extends BaseACL<'email_channel_preferences'> {

  async canInsert(args: InsertValue<TableSchema<'email_channel_preferences'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
    if (!channel) {
      throw new MutationACLError('Email channel preference insert failed: channel does not exist', 'email_channel_preferences');
    }

    if (channel.type !== ChannelType.EMAIL) {
      throw new MutationACLError('Email channel preference insert failed: preferences can only be set on EMAIL channels', 'email_channel_preferences');
    }

    if (channel.isArchived) {
      throw new MutationACLError('Email channel preference insert failed: cannot modify preferences on an archived channel', 'email_channel_preferences');
    }

    await this.verifyChannelParticipant(args.channelId, tx, 'insert');

    if (args.sendAsEmail != null) {
      this.assertSendAsEmailGate(channel.createdBy, args.ownerUserId ?? null, 'insert');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'email_channel_preferences'>>, tx: Transaction<Schema>): Promise<void> {
    const preference = await tx.run(zql.email_channel_preferences.where('channelId', args.channelId).one());
    if (!preference) {
      throw new MutationACLError('Email channel preference update failed: preference does not exist', 'email_channel_preferences');
    }

    const channel = await tx.run(zql.channels.where('id', preference.channelId).one());
    if (!channel) {
      throw new MutationACLError('Email channel preference update failed: channel does not exist', 'email_channel_preferences');
    }

    if (channel.type !== ChannelType.EMAIL) {
      throw new MutationACLError('Email channel preference update failed: preferences can only be set on EMAIL channels', 'email_channel_preferences');
    }

    if (channel.isArchived) {
      throw new MutationACLError('Email channel preference update failed: cannot modify preferences on an archived channel', 'email_channel_preferences');
    }

    await this.verifyChannelParticipant(preference.channelId, tx, 'update');

    if (args.sendAsEmail !== undefined) {
      this.assertSendAsEmailGate(channel.createdBy, preference.ownerUserId ?? null, 'update');
    }
  }

  private assertSendAsEmailGate(
    channelCreatedBy: string,
    preferenceOwnerUserId: string | null,
    operation: 'insert' | 'update',
  ): void {
    const userId = this.ctx.userID;
    if (userId === channelCreatedBy) return;
    if (preferenceOwnerUserId && preferenceOwnerUserId === userId) return;
    throw new MutationACLError(
      `Email channel preference ${operation} failed: only the desk owner or creator can change the send-as alias`,
      'email_channel_preferences',
    );
  }

  async canDelete(_args: DeleteID<TableSchema<'email_channel_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email channel preference delete failed: preferences cannot be deleted', 'email_channel_preferences');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'email_channel_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email channel preference upsert failed: use insert or update operations separately', 'email_channel_preferences');
  }

  private async verifyChannelParticipant(channelId: string, tx: Transaction<Schema>, operation: 'insert' | 'update'): Promise<void> {
    const participant = await tx.run(zql.channel_participants
      .where('channelId', channelId)
      .where('userId', this.ctx.userID)

      .one());

    if (!participant) {
      throw new MutationACLError(
        `Email channel preference ${operation} failed: you must be a channel participant to ${operation} preferences`,
        'email_channel_preferences',
      );
    }
  }
}
