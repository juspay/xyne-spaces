import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ChannelParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ChannelScopeType } from '@xyne/shared';
import { refreshCanvasPermissionsForChannel } from '@/services/canvasPermissionSync';
import { connectMemberSyncService } from '@/services/connectMemberSyncService';

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

    // Slack-Connect: mirror the removal into connect_channel_member (tombstone). No-op
    // for non-connect channels.
    await connectMemberSyncService
      .mirrorParticipantRemoved(previousValue.channelId, previousValue.userId)
      .catch(err =>
        logger.error(`[ChannelParticipantsHandler] connect member sync (remove) failed for channel ${previousValue.channelId}: ${err}`),
      );
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ChannelParticipantsHandler] onInsert called for entity: ${job.entityId}`);

    try {
      // Query DB for participant record. runAsSystem: this side-effect runs under WHOEVER triggered the
      // write (often a GUEST). A cross-org add lands the participant on the HOST channel (host workspace),
      // so a caller-scoped read here returns null → the connect member-sync mirror below never fires and the
      // member row / hidden-status is never written (the "guest add shows added but no member" bug).
      const participant = await runAsSystem(async () => {
        return await db.channelParticipant.findUnique({
          where: { id: job.entityId },
          select: {
            channelId: true,
            userId: true,
          },
        });
      });

      if (!participant) {
        logger.warn(`[ChannelParticipantsHandler] Participant not found for ID: ${job.entityId}`);
        return;
      }

      const { channelId, userId } = participant;

      // Member joined → refresh canvases shared to this channel (regardless of notification).
      await refreshCanvasPermissionsForChannel(channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${channelId}: ${err}`));

      // Slack-Connect: mirror the add into connect_channel_member. MUST run before the
      // self-join early-return below so a user joining themselves is still mirrored.
      // No-op for non-connect channels.
      await connectMemberSyncService
        .mirrorParticipantAdded(channelId, userId)
        .catch(err =>
          logger.error(`[ChannelParticipantsHandler] connect member sync (add) failed for channel ${channelId}: ${err}`));

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

      logger.info(`[ChannelParticipantsHandler] Notification sent for user ${userId} added to channel ${channelId} by ${adderName}`);

    } catch (error) {
      logger.error(`[ChannelParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }
}
