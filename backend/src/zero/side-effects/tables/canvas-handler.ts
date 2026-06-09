import { ActivityClassification } from '@prisma/client';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { repositories } from '@/database/repositories/index';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { logger } from '@/utils/logger';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';

/**
 * Handler for canvas-related side effects
 * Handles activity and notification creation for canvas mentions
 */
export class CanvasSideEffectHandler extends BaseSideEffectHandler {
  /**
   * Handle canvas insert events to create activities and notifications for mentions
   */
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const canvasId = job.entityId;

    try {
      // Get the canvas details
      const canvas = await db.canvas.findUnique({
        where: { id: canvasId },
        select: {
          id: true,
          title: true,
          channelId: true,
          createdBy: true,
          metadata: true,
        },
      });

      if (!canvas) {
        logger.warn(`[CanvasSideEffectHandler] Canvas ${canvasId} not found`);
        return;
      }

      // Track canvas creation activity
      void userActivityTrackingService.trackCanvasCreated(this.ctx.userID, {
        canvasId: canvas.id,
        title: canvas.title,
      });

      // Extract mentioned user IDs from metadata
      const metadata = canvas.metadata as any;
      const mentionedUserIds: string[] = metadata?.mentionedUserIds || [];

      if (mentionedUserIds.length === 0) {
        logger.info(`[CanvasSideEffectHandler] No mentions found in canvas ${canvasId}`);
        return;
      }

      const createdByUserId = canvas.createdBy;

      // Filter out the creator from recipients
      const recipientIds = mentionedUserIds.filter((id: string) => id !== createdByUserId);

      if (recipientIds.length === 0) {
        logger.info(`[CanvasSideEffectHandler] No recipients to notify for canvas ${canvasId}`);
        return;
      }

      logger.info(`[CanvasSideEffectHandler] Sending mention notifications to ${recipientIds.length} users for canvas ${canvasId}`);

      // Get sender name (bot name)
      const bot = await repositories.users.findById(createdByUserId);
      const senderName = bot?.name || 'Xyne Automatic';

      // Get channel name if canvas is in a channel
      let channelName: string | undefined;
      if (canvas.channelId) {
        const channel = await db.channel.findUnique({
          where: { id: canvas.channelId },
          select: { name: true },
        });
        channelName = channel?.name || undefined;
      }

      // Create activity entries for activity tab
      const activities = recipientIds.map(userId => ({
        userId,
        actorId: createdByUserId,
        actorAction: 'mentioned_user', // AI mentions are always direct mentions (not group mentions)
        actionSource: 'canvas' as const,
        actionSourceId: canvasId,
        channelId: canvas.channelId || undefined,
        canvasId: canvasId,
        blockId: undefined, // no specific blockId for AI-generated content
        classification: ActivityClassification.PENDING,
      }));

      logger.info(`[CanvasSideEffectHandler] Creating ${activities.length} activity entries for canvas mentions`, {
        canvasId,
        recipientIds,
        activities: activities.map(a => ({ userId: a.userId, actorAction: a.actorAction, canvasId: a.canvasId })),
      });

      // Create activities and send notifications (fire and forget - don't block canvas creation)
      Promise.all([
        activityService.createActivities(activities),
        notificationService.createCanvasMentionNotifications(
          recipientIds,
          canvasId,
          canvas.title,
          createdByUserId,
          senderName,
          this.ctx.workspaceId,
          channelName,
          undefined, // no specific blockId for AI-generated content
          canvas.channelId ?? undefined,
        ),
      ]).then(() => {
        logger.info(`[CanvasSideEffectHandler] Successfully created activities and notifications for canvas ${canvasId}`);
      }).catch(error => {
        logger.error('[CanvasSideEffectHandler] Failed to create activities or send mention notifications:', error);
      });

      // Queue Vespa indexing job for the canvas
      try {
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: canvasId,
          jobType: 'feed',
          userId: canvas.createdBy,
          workspaceId: this.ctx.workspaceId,
          app: SubApp.CANVAS,
        });
        logger.info(`[CanvasSideEffectHandler] Queued Vespa indexing for canvas ${canvasId}`);
      } catch (error) {
        logger.error(`[CanvasSideEffectHandler] Failed to queue Vespa job for canvas ${canvasId}:`, error);
        // Don't throw - we don't want to fail the main canvas creation
      }
    } catch (error) {
      logger.error(`[CanvasSideEffectHandler] Failed to handle canvas insert:`, error);
      // Don't throw - we don't want to fail the main canvas creation
    }
  }
    /**
   * Handle canvas update events to queue Vespa indexing
   */
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const canvasId = job.entityId;

    try {
      // Get the canvas details to get the creator for Vespa job
      const canvas = await db.canvas.findUnique({
        where: { id: canvasId },
        select: {
          createdBy: true,
        },
      });

      if (!canvas) {
        logger.warn(`[CanvasSideEffectHandler] Canvas ${canvasId} not found during update`);
        return;
      }

      // Queue Vespa indexing job for the canvas
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed', // Re-feed to update
        userId: canvas.createdBy,
        workspaceId: this.ctx.workspaceId,
        app: SubApp.CANVAS,
      });
      logger.info(`[CanvasSideEffectHandler] Queued Vespa indexing for updated canvas ${canvasId}`);
    } catch (error) {
      logger.error(`[CanvasSideEffectHandler] Failed to queue Vespa job for updated canvas ${canvasId}:`, error);
    }
  }
}
