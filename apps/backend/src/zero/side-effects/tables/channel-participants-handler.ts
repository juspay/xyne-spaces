import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ChannelParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ChannelScopeType, ActivityClassification } from '@xyne/shared';
import { refreshCanvasPermissionsForChannel } from '@/services/canvasPermissionSync';
import { activityService } from '@/services/activity/activityService';

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
    await refreshCanvasPermissionsForChannel(previousValue.channelId).catch(err =>
      logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${previousValue.channelId}: ${err}`),
    );
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

      // Member joined → refresh canvases shared to this channel (regardless of notification).
      await refreshCanvasPermissionsForChannel(channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${channelId}: ${err}`));


      if (this.ctx.userID === userId) {
        logger.info(`[ChannelParticipantsHandler] User ${userId} joined channel ${channelId} themselves - skipping notification`);
        return; // Don't notify user when they join themselves
      }

      // Someone else added them - get the adder's info
      const adder = await db.user.findUnique({
        where: { id: this.ctx.userID },
        select: { name: true, displayName: true, id: true }
      });
      const adderName = adder?.displayName || adder?.name || 'Someone';
      const adderId = adder?.id || 'unknown';
      
      logger.info(`[ChannelParticipantsHandler] User ${userId} was added to channel ${channelId} by ${this.ctx.userID} (${adderName})`);

      // Query channel for name
      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { name: true, scopeType: true }
      });

      const channelName = channel?.name || 'a channel';

      // Send notification to the added user
      await notificationService.createParticipantAddedNotifications(
        [userId],
        channelId,
        channel?.scopeType === ChannelScopeType.GROUP_DM ? 'a group DM' : channelName,
        adderId,
        adderName,
        this.ctx.workspaceId
      );

      // Mirror the notification into the activity feed. Being added to a channel
      // was previously push-only: a user who missed or dismissed the push had no
      // record of it in Activity. The activity id is the participant row id, so a
      // retried side-effect job cannot create a second row for the same add.
      await activityService
        .createActivities([
          {
            id: job.entityId,
            userId,
            workspaceId: this.ctx.workspaceId,
            actorId: adderId,
            actorAction: 'channel_added',
            actionSource: 'channel',
            actionSourceId: channelId,
            channelId,
            classification: ActivityClassification.FYI,
          },
        ])
        .catch(err =>
          logger.error(
            `[ChannelParticipantsHandler] channel_added activity failed for user ${userId} in channel ${channelId}: ${err}`,
          ),
        );

      logger.info(`[ChannelParticipantsHandler] Notification sent for user ${userId} added to channel ${channelId} by ${adderName}`);

    } catch (error) {
      logger.error(`[ChannelParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }
}
