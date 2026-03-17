import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelAddUserPolicy, ChannelRole, ChannelScopeType, NotificationLevel, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Disallowed notification levels for DM channels
const DISALLOWED_DM_NOTIFICATION_LEVELS = [NotificationLevel.MENTIONS_ONLY, NotificationLevel.THREADS_ONLY];

export class ChannelUserStatusACL extends BaseACL<'channel_user_status'> {

  async canInsert(args: InsertValue<TableSchema<'channel_user_status'>>, tx: Transaction<Schema>): Promise<void> {
    // Fetch the channel to check addUserPolicy
    const channel = await tx.run(zql.channels.where('id', '=', args.channelId).one());

    // Verify requesting user is a channel participant and get their record
    const requestingParticipant = await this.verifyChannelParticipant(args.channelId, tx, 'insert');

    // Check addUserPolicy: if ADMINS_ONLY, only admins can add users
    const addUserPolicy = channel?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
    if (addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY && requestingParticipant.role !== ChannelRole.ADMIN) {
      throw new MutationACLError('Channel user status insert failed: only channel admins can add users to this channel', 'channel_user_status');
    }

    await this.validateDMChannelNotificationLevels(args.channelId, args.desktopNotificationLevel, args.mobileNotificationLevel, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_user_status'>>, tx: Transaction<Schema>): Promise<void> {
    const status = await tx.run(zql.channel_user_status.where('id', '=', args.id).one());
    
    if (!status) {
      throw new MutationACLError('Channel user status update failed: status record does not exist', 'channel_user_status');
    }
    
    // Only the user themselves can update their status record
    if (status.userId !== this.ctx.userID) {
      throw new MutationACLError('Channel user status update failed: you can only modify your own status records', 'channel_user_status');
    }

    // Prevent updates to immutable fields (id, channelId, userId should not be in args)
    if ('id' in args && args.id !== status.id) {
      throw new MutationACLError('Channel user status update failed: id cannot be modified', 'channel_user_status');
    }
    if ('channelId' in args) {
      throw new MutationACLError('Channel user status update failed: channelId cannot be modified', 'channel_user_status');
    }
    if ('userId' in args) {
      throw new MutationACLError('Channel user status update failed: userId cannot be modified', 'channel_user_status');
    }

    const desktopLevel = args.desktopNotificationLevel ?? status.desktopNotificationLevel;
    const mobileLevel = args.mobileNotificationLevel ?? status.mobileNotificationLevel;
    await this.validateDMChannelNotificationLevels(status.channelId, desktopLevel, mobileLevel, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'channel_user_status'>>, tx: Transaction<Schema>): Promise<void> {
    const status = await tx.run(zql.channel_user_status.where('id', '=', args.id).one());
    
    if (!status) {
      throw new MutationACLError('Channel user status delete failed: status record does not exist', 'channel_user_status');
    }
    
    // Allow delete if:
    // 1. The requesting user is the owner of the status record, OR
    // 2. The requesting user is a channel ADMIN
    if (status.userId === this.ctx.userID) {
      return;
    }

    // Verify requesting user is a channel participant and check if they're an admin
    const requestingParticipant = await this.verifyChannelParticipant(status.channelId, tx, 'delete');

    if (requestingParticipant.role === ChannelRole.ADMIN) {
      return;
    }

    throw new MutationACLError('Channel user status delete failed: you can only delete your own status records or be a channel admin', 'channel_user_status');
  }

  private async verifyChannelParticipant(channelId: string, tx: Transaction<Schema>, operation: 'insert' | 'update' | 'delete'): Promise<{ role: string }> {
    const participant = await tx.run(zql.channel_participants
      .where('channelId', '=', channelId)
      .where('userId', '=', this.ctx.userID)
      .one());
    
    if (!participant) {
      throw new MutationACLError(`Channel user status ${operation} failed: you must be a channel participant to ${operation} a status record`, 'channel_user_status');
    }
    
    return participant;
  }

  private async validateDMChannelNotificationLevels(
    channelId: string,
    desktopNotificationLevel: string | null | undefined,
    mobileNotificationLevel: string | null | undefined,
    tx: Transaction<Schema>
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', '=', channelId).one());
    
    // Disallowed notification levels apply to both DM and GROUP_DM channels
    if (channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM) {
      if (desktopNotificationLevel && DISALLOWED_DM_NOTIFICATION_LEVELS.includes(desktopNotificationLevel as NotificationLevel)) {
        throw new MutationACLError(
          `Channel user status update failed: ${desktopNotificationLevel} notification level is not allowed for DM channels`,
          'channel_user_status'
        );
      }
      
      if (mobileNotificationLevel && DISALLOWED_DM_NOTIFICATION_LEVELS.includes(mobileNotificationLevel as NotificationLevel)) {
        throw new MutationACLError(
          `Channel user status update failed: ${mobileNotificationLevel} notification level is not allowed for DM channels`,
          'channel_user_status'
        );
      }
    }
  }
}
