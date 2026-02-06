import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { ActivityClassification } from '@prisma/client';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

export class NotificationHooks {

  static async onTicketAssignment(
    ticketId: string,
    assignedTo: string,
    assignedBy: string
  ): Promise<void> {
    try {
      logger.info(`[NotificationHooks] onTicketAssignment: ticketId=${ticketId}, assignedTo=${assignedTo}, assignedBy=${assignedBy}`);

      // Get ticket details for activity
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          xyneId: true,
          title: true,
          channelId: true,
          conversationId: true,
        },
      });

      // Send notification
      await notificationService.sendTicketAssignmentNotification(
        ticketId,
        assignedTo,
        assignedBy
      );
      logger.info(`[NotificationHooks] Notification sent for ticket ${ticketId} to user ${assignedTo}`);

      // Create activity entry for the new assignee
      if (ticket) {
        await activityService.createActivity({
          userId: assignedTo,
          actorAction: 'ticket_assigned',
          actionSource: 'ticket',
          actionSourceId: ticketId,
          ticketId: ticketId,
          channelId: ticket.channelId || undefined,
          actorId: assignedBy,
          classification: ActivityClassification.ACTIONABLE,
        });
        logger.info(`[NotificationHooks] Created activity for ticket assignment: ${ticketId} to user ${assignedTo}`);
      }
    } catch (error) {
      logger.error('[NotificationHooks] Failed to send ticket assignment notification:', error);
    }
  }

  static async onWorkflowCompletion(
    workflowId: string,
    status: string
  ): Promise<void> {
    try {
      await notificationService.sendWorkflowCompletionNotification(workflowId, status);
    } catch (error) {
      logger.error('Failed to send workflow completion notification:', error);
    }
  }
}

export const notificationHooks = NotificationHooks;