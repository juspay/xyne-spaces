import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ChannelScopeType } from '@xyne/shared';

export class ChannelParticipantsSideEffectHandler extends BaseSideEffectHandler {

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

      if (this.ctx.userID === userId) {
        logger.info(`[ChannelParticipantsHandler] User ${userId} joined channel ${channelId} themselves - skipping notification`);
        return; // Don't notify user when they join themselves
      }

      // Someone else added them - get the adder's info
      const adder = await db.user.findUnique({
        where: { id: this.ctx.userID },
        select: { name: true, id: true }
      });
      const adderName = adder?.name || 'Someone';
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
