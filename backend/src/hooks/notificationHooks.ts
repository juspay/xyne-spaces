import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

export class NotificationHooks {

  static async onTicketAssignment(
    ticketId: string,
    assignedTo: string,
    assignedBy: string
  ): Promise<void> {
    try {
      await notificationService.sendTicketAssignmentNotification(
        ticketId,
        assignedTo,
        assignedBy
      );
    } catch (error) {
      logger.error('Failed to send ticket assignment notification:', error);
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