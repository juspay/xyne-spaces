import { ActivityClassification } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, TicketPreviousValue } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { logger } from '@/utils/logger';

interface TicketActivity {
  activityType: string;
  value: {
    oldValue: any;
    newValue: any;
  };
}

export class TicketsSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: ticketId, args, previousValue } = job;

    if (!previousValue) {
      logger.warn(`[TicketsSideEffectHandler] No previousValue for ticket ${ticketId}`);
      return;
    }

    const prev = previousValue as TicketPreviousValue;
    const actorId = this.ctx.userID;

    // Detect field changes and build activities
    const activities: TicketActivity[] = [];
    const fieldsToTrack = ['stageName', 'eta', 'boardId', 'assignedTo'] as const;
    const changedFields: string[] = [];

    for (const field of fieldsToTrack) {
      if (args[field] !== undefined && args[field] !== prev[field]) {
        let activityType = field.toUpperCase();
        if (field === 'stageName') activityType = 'STATUS';
        if (field === 'assignedTo') activityType = 'ASSIGNED';
        if (field === 'eta') activityType = 'ETA';
        if (field === 'boardId') activityType = 'BOARD';

        activities.push({
          activityType,
          value: {
            oldValue: prev[field],
            newValue: args[field],
          },
        });
        changedFields.push(field);
      }
    }

    if (changedFields.length > 0) {
      void userActivityTrackingService.trackTicketUpdated(actorId, {
        ticketId,
        fields: changedFields,
        boardId: args.boardId || prev.boardId || undefined,
      }).catch(error => {
        logger.error('[UserActivityTracking] Failed to track ticket updated activity:', {
          ticketId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    // Send notification to the newly assigned user
    const assignedToChanged = args.assignedTo !== undefined && args.assignedTo !== prev.assignedTo;
    const newAssignee = args.assignedTo;

    if (assignedToChanged && newAssignee && newAssignee !== actorId) {
      try {
        await notificationService.sendTicketAssignmentNotification(ticketId, newAssignee, actorId);
        logger.info(`[TicketsSideEffectHandler] Sent ticket assignment notification for ticket ${ticketId} to user ${newAssignee}`);
      } catch (error) {
        logger.error(`[TicketsSideEffectHandler] Failed to send ticket assignment notification:`, error);
      }
    }

    // Create activities for relevant users (creator, old assignee, new assignee, excluding the actor)
    const usersToNotify = [
      prev.createdBy,
      prev.assignedTo,
      args.assignedTo,
    ].filter((userId, index, arr): userId is string =>
      Boolean(userId) && userId !== actorId && arr.indexOf(userId) === index
    );

    // Only create activities for STATUS, ETA, BOARD, ASSIGNED_TO changes
    const relevantActivities = activities.filter(a =>
      ['STATUS', 'ETA', 'BOARD', 'ASSIGNED'].includes(a.activityType)
    );

    if (usersToNotify.length === 0 || relevantActivities.length === 0) {
      return;
    }

    logger.info(`[TicketsSideEffectHandler] usersToNotify: ${JSON.stringify(usersToNotify)}, activities: ${JSON.stringify(relevantActivities.map(a => a.activityType))}`);

    try {
      // Fetch ticket for activity details (channelId)
      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
        },
      });

      if (!ticket) {
        logger.warn(`[TicketsSideEffectHandler] Ticket ${ticketId} not found for activity creation`);
        return;
      }

      // Create activities for each relevant change
      for (const activity of relevantActivities) {
        const actorAction = `ticket_${activity.activityType.toLowerCase()}`;

        if (usersToNotify.length === 0) continue;

        logger.info(`[TicketsSideEffectHandler] Creating activity: ${actorAction} for users: ${usersToNotify.join(', ')}`);

        for (const userId of usersToNotify) {
          await activityService.createActivity({
            userId,
            actorAction,
            actionSource: 'ticket',
            actionSourceId: ticketId,
            ticketId: ticketId,
            channelId: ticket.channelId || undefined,
            actorId,
            classification: ActivityClassification.ACTIONABLE,
          });
        }
      }

      logger.info(`[TicketsSideEffectHandler] Created activities for ticket ${ticketId} for users: ${usersToNotify.join(', ')}`);
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create activities:`, error);
    }
  }

  /**
   * Helper function to create ETA breach activities (overall ETA or stage ETA).
   * Can be called from outside (e.g., etaDeadlineQueue, stageEtaDeadlineQueue) to create activities.
   * This is a static method - does not use side effect context.
   */
  static async createEtaBreachActivities(params: {
    ticketId: string;
    xyneId: string;
    channelId: string;
    userIds: string[];
    actorAction: 'eta_breach' | 'stage_eta_breach';
    actorId?: string;
    stageName?: string;
    daysOverdue?: number;
  }): Promise<void> {
    const { ticketId, xyneId, channelId, userIds, actorAction, actorId = 'system', stageName, daysOverdue } = params;

    if (userIds.length === 0) {
      return;
    }

    try {
      // Create activities for each user
      const activityPromises = userIds.map(userId =>
        activityService.createActivity({
          userId,
          actorAction,
          actionSource: 'ticket',
          actionSourceId: ticketId,
          ticketId: ticketId,
          channelId: channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        })
      );

      await Promise.all(activityPromises);

      logger.info(
        `[TicketsSideEffectHandler] Created ${userIds.length} ${actorAction} activities for ticket ${xyneId}` +
        `${stageName ? ` (stage: ${stageName})` : ''}` +
        `${daysOverdue !== undefined ? ` (${daysOverdue} days overdue)` : ''}`
      );
    } catch (error) {
      logger.error(`[TicketsSideEffectHandler] Failed to create ${actorAction} activities:`, error);
      throw error;
    }
  }
}
