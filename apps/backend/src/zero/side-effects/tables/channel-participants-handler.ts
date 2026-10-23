import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ChannelParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ChannelScopeType } from '@xyne/shared';
import { refreshCanvasPermissionsForChannel } from '@/services/canvasPermissionSync';
import { refreshRecordingTranscriptPermissionsForChannel } from '@/services/recordingTranscriptPermissionSync';
import { gatewayHooks } from '@/gateway';

export class ChannelParticipantsSideEffectHandler extends BaseSideEffectHandler {

  /**
   * A member joined/left this channel → refresh the denormalized ACL of every canvas
   * shared to it. This is the precise membership signal (unlike a chat_container
   * re-feed, which also fires on message activity), so canvases aren't recomputed on
   * every message.
   */
  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as ChannelParticipantPreviousValue | undefined;
    if (!previousValue) {
      logger.warn(`[ChannelParticipantsHandler] No previousValue for deleted participant ID: ${job.entityId}`);
      return;
    }
    gatewayHooks.onParticipantChanged({ type: 'removed', channelId: previousValue.channelId, userId: previousValue.userId });
    await Promise.all([
      refreshCanvasPermissionsForChannel(previousValue.channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${previousValue.channelId}: ${err}`),
      ),
      refreshRecordingTranscriptPermissionsForChannel(previousValue.channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] recording ACL refresh failed for channel ${previousValue.channelId}: ${err}`),
      ),
    ]);
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ChannelParticipantsHandler] onInsert called for entity: ${job.entityId}`);

    try {
      // Query DB for participant record
      const participant = await db.channelParticipant.findUnique({
        where: { id: job.entityId },
        select: {
          channelId: true,
          userId: true,
        }
      });

      if (!participant) {
        logger.warn(`[ChannelParticipantsHandler] Participant not found for ID: ${job.entityId}`);
        return;
      }

      const { channelId, userId } = participant;
      gatewayHooks.onParticipantChanged({ type: 'added', channelId, userId });

      // Member joined → refresh canvases shared to this channel (regardless of notification).
      await this.refreshChannelAccess(channelId);
      await this.notifyAdded(channelId, [userId]);
    } catch (error) {
      logger.error(`[ChannelParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }

  /**
   * Several people added to one channel in one call. The channel-wide canvas and recording refresh
   * covers every canvas and recording in the channel, not one person's access, so it runs once here
   * instead of once per person; only the notification is per person.
   */
  async onBatchInsert(channelId: string, userIds: string[]): Promise<void> {
    logger.info(`[ChannelParticipantsHandler] onBatchInsert called for channel ${channelId} with ${userIds.length} users`);

    try {
      await this.refreshChannelAccess(channelId);
      await this.notifyAdded(channelId, userIds);
    } catch (error) {
      logger.error(`[ChannelParticipantsHandler] Failed to process onBatchInsert for channel ${channelId}:`, error);
    }
  }

  private async refreshChannelAccess(channelId: string): Promise<void> {
    await Promise.all([
      refreshCanvasPermissionsForChannel(channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${channelId}: ${err}`)),
      refreshRecordingTranscriptPermissionsForChannel(channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] recording ACL refresh failed for channel ${channelId}: ${err}`)),
    ]);
  }

  private async notifyAdded(channelId: string, userIds: string[]): Promise<void> {
    // Don't notify a user who joined themselves.
    const others = userIds.filter(userId => userId !== this.ctx.userID);
    if (others.length === 0) {
      logger.info(`[ChannelParticipantsHandler] Only the actor joined channel ${channelId} - skipping notification`);
      return;
    }

    // Someone else added them - get the adder's info
    const adder = await db.user.findUnique({
      where: { id: this.ctx.userID },
      select: { name: true, displayName: true, id: true }
    });
    const adderName = adder?.displayName || adder?.name || 'Someone';
    const adderId = adder?.id || 'unknown';

    logger.info(`[ChannelParticipantsHandler] ${others.length} user(s) were added to channel ${channelId} by ${this.ctx.userID} (${adderName})`);

    // Query channel for name
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { name: true, scopeType: true }
    });

    const channelName = channel?.name || 'a channel';

    // Send notification to the added users
    await notificationService.createParticipantAddedNotifications(
      others,
      channelId,
      channel?.scopeType === ChannelScopeType.GROUP_DM ? 'a group DM' : channelName,
      adderId,
      adderName,
      this.ctx.workspaceId
    );

    logger.info(`[ChannelParticipantsHandler] Notification sent for ${others.length} user(s) added to channel ${channelId} by ${adderName}`);
  }
}
