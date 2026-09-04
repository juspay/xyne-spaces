import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelAddUserPolicy, ChannelRole, ChannelScopeType, NotificationLevel, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Disallowed notification levels for DM channels
const DISALLOWED_DM_NOTIFICATION_LEVELS = [NotificationLevel.MENTIONS_ONLY, NotificationLevel.THREADS_ONLY];

export class ChannelUserStatusACL extends BaseACL<'channel_user_status'> {

  private async verifyChannelInWorkspace(channelId: string, tx: Transaction<Schema>, workspaceId?: string): Promise<void> {
    const channelWorkspaceId = workspaceId ?? await tx.run(zql.channels.where('id', '=', channelId).one()).then(c => c?.workspaceId);
    if (!channelWorkspaceId) throw new MutationACLError('Channel user status not found: channel does not exist', 'channel_user_status');
    if (channelWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Channel user status not found in this workspace', 'channel_user_status');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'channel_user_status'>>, tx: Transaction<Schema>): Promise<void> {
    // Fetch the channel to check workspace and addUserPolicy
    const channel = await tx.run(zql.channels.where('id', '=', args.channelId).one());
    if (!channel) throw new MutationACLError('Channel user status insert failed: channel does not exist', 'channel_user_status');
    await this.verifyChannelInWorkspace(args.channelId, tx, channel.workspaceId);

    // Verify requesting user is a channel participant and get their record
    const requestingParticipant = await this.verifyChannelParticipant(args.channelId, tx, 'insert');

    // Check addUserPolicy: if ADMINS_ONLY, only admins can add *other* users.
    // Joining yourself is governed by channel visibility, and group DMs manage
    // membership through their own flow, so both are exempt (matches the checks
    // in addParticipants / handleNonParticipantAction).
    const isSelfInsert = args.userId === this.ctx.userID;
    const isGroupDM = channel.scopeType === ChannelScopeType.GROUP_DM;
    if (!isSelfInsert && !isGroupDM) {
      const channelStats = await tx.run(zql.channel_stats.where('channelId', '=', args.channelId).one());
      const addUserPolicy = channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
      if (addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY && requestingParticipant.role !== ChannelRole.ADMIN) {
        throw new MutationACLError('Channel user status insert failed: only channel admins can add users to this channel', 'channel_user_status');
      }
    }

    await this.validateDMChannelNotificationLevels(args.channelId, args.desktopNotificationLevel, args.mobileNotificationLevel, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_user_status'>>, tx: Transaction<Schema>): Promise<void> {
    const status = await tx.run(zql.channel_user_status.where('id', '=', args.id).one());
    
    if (!status) {
      throw new MutationACLError('Channel user status update failed: status record does not exist', 'channel_user_status');
    }
    await this.verifyChannelInWorkspace(status.channelId, tx);

    const argsKeys = Object.keys(args);
    
    // Allow updating only `isClosed` and `updatedAt` on any user's status (e.g., admin closing a channel for a user)
    const allowedIsClosedOnlyKeys = ['id', 'isClosed', 'updatedAt'];
    const isClosedOnlyUpdate = argsKeys.every(k => allowedIsClosedOnlyKeys.includes(k)) && argsKeys.includes('isClosed');
    
    // Check if this is a soft delete operation (isDeleted is being set to true)
    const isSoftDelete = 'isDeleted' in args && args.isDeleted === true;
    
    // Check if this is a restore operation (isDeleted is being set to false)
    const isRestore = 'isDeleted' in args && args.isDeleted === false;
    
    // For soft delete, only owner or admin can delete
    if (isSoftDelete) {
      const allowedSoftDeleteKeys = ['id', 'isDeleted', 'updatedAt'];
      const invalidKeys = argsKeys.filter(k => !allowedSoftDeleteKeys.includes(k));
      if (invalidKeys.length > 0) {
        throw new MutationACLError('Channel user status soft delete failed: invalid keys', 'channel_user_status');
      }
      if (status.userId === this.ctx.userID) {
        return;
      }
      
      const requestingParticipant = await this.verifyChannelParticipant(status.channelId, tx, 'update');
      if (requestingParticipant.role !== ChannelRole.ADMIN) {
        throw new MutationACLError('Channel user status soft delete failed: you can only delete your own status records or be a channel admin', 'channel_user_status');
      }
      
      return;
    }
    
    // For restore (isDeleted: false), only allow updating specific columns
    if (isRestore) {
      const allowedRestoreKeys = ['id', 'isDeleted', 'isClosed', 'lastViewedAt', 'updatedAt', 'unreadCount', 'conversationSeenCutoffAt'];
      const invalidKeys = argsKeys.filter(k => !allowedRestoreKeys.includes(k));
      if (invalidKeys.length > 0) {
        throw new MutationACLError('Channel user status restore failed: invalid keys', 'channel_user_status');
      }
      
      const requestingParticipant = await this.verifyChannelParticipant(status.channelId, tx, 'update');

      // Same exemptions as insert: restoring your own membership (e.g. rejoining a
      // public channel) and group DMs are not governed by addUserPolicy.
      if (status.userId !== this.ctx.userID) {
        const restoreChannel = await tx.run(zql.channels.where('id', '=', status.channelId).one());
        if (restoreChannel?.scopeType !== ChannelScopeType.GROUP_DM) {
          const channelStats = await tx.run(zql.channel_stats.where('channelId', '=', status.channelId).one());
          const addUserPolicy = channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
          if (addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY && requestingParticipant.role !== ChannelRole.ADMIN) {
            throw new MutationACLError('Channel user status restore failed: only channel admins can restore users to this channel', 'channel_user_status');
          }
        }
      }
      return;
    }
    
    // Only the user themselves can update their status record (unless it's a isClosed-only update)
    if (status.userId !== this.ctx.userID && !isClosedOnlyUpdate) {
      throw new MutationACLError('Channel user status update failed: you can only modify your own status records', 'channel_user_status');
    }

    // Prevent updates to immutable fields (id, channelId, userId should not be in args)
    if (args.id !== undefined && args.id !== status.id) {
      throw new MutationACLError('Channel user status update failed: id cannot be modified', 'channel_user_status');
    }
    if (args.channelId !== undefined) {
      throw new MutationACLError('Channel user status update failed: channelId cannot be modified', 'channel_user_status');
    }
    if (args.userId !== undefined) {
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
    await this.verifyChannelInWorkspace(status.channelId, tx);

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
    
    // Disallowed notification levels apply only to 1:1 DM channels.
    // GROUP_DM uses the regular channel notification path and supports MENTIONS_ONLY.
    if (channel?.scopeType === ChannelScopeType.DM) {
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
