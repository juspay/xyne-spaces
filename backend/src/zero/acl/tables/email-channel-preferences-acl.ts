import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelRole, Schema, isDeskChannelType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class EmailChannelPreferencesACL extends BaseACL<'email_channel_preferences'> {

  async canInsert(args: InsertValue<TableSchema<'email_channel_preferences'>>, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
    if (!channel) {
      throw new MutationACLError('Email channel preference insert failed: channel does not exist', 'email_channel_preferences');
    }

    if (!isDeskChannelType(channel.type)) {
      throw new MutationACLError('Email channel preference insert failed: preferences can only be set on desk channels (EMAIL, SLACK, APP)', 'email_channel_preferences');
    }

    if (channel.isArchived) {
      throw new MutationACLError('Email channel preference insert failed: cannot modify preferences on an archived channel', 'email_channel_preferences');
    }

    await this.verifyChannelParticipant(args.channelId, tx, 'insert');

    const isAdmin = await this.isChannelAdmin(args.channelId, tx);
    if (!isAdmin) {
      throw new MutationACLError(
        'Email channel preference insert failed: only a channel admin can create the desk preference',
        'email_channel_preferences',
      );
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

    if (!isDeskChannelType(channel.type)) {
      throw new MutationACLError('Email channel preference update failed: preferences can only be set on desk channels (EMAIL, SLACK, APP)', 'email_channel_preferences');
    }

    if (channel.isArchived) {
      throw new MutationACLError('Email channel preference update failed: cannot modify preferences on an archived channel', 'email_channel_preferences');
    }

    await this.verifyChannelParticipant(preference.channelId, tx, 'update');

    const hasChanges = Object.keys(args).some(key => key !== 'channelId');
    if (!hasChanges) return;

    const ownerUserId = preference.ownerUserId ?? null;
    const isDeskOwner = ownerUserId !== null && ownerUserId === this.ctx.userID;
    const canManage = isDeskOwner || (await this.isChannelAdmin(preference.channelId, tx));

    if (!canManage) {
      throw new MutationACLError(
        'Email channel preference update failed: only the desk owner or a channel admin can change this desk',
        'email_channel_preferences',
      );
    }
  }

  private async isChannelAdmin(channelId: string, tx: Transaction<Schema>): Promise<boolean> {
    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', channelId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    return participant?.role === ChannelRole.ADMIN;
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
