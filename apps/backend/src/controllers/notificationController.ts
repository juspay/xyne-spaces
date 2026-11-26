import { Request, Response } from 'express';
import { notificationService } from '@/services/notificationService';
import { unreadService } from '@/services/unreadService';
import { logger } from '@/utils/logger';
import { z } from 'zod';

const preferencesSchema = z.record(
  z.enum([
    'TICKET_STATUS_CHANGE',
    'TICKET_ASSIGNMENT',
    'TICKET_REASSIGNMENT',
    'TICKET_DUE_DATE_CHANGED',
    'TICKET_PRIORITY_CHANGED',
    'TICKET_USER_GROUP_CHANGED',
    'TICKET_TITLE_CHANGED',
    'TICKET_DESCRIPTION_CHANGED',
    'TICKET_RCA_CREATED',
    'TICKET_RCA_UPDATED',
    'TICKET_SUBTICKET_ADDED',
    'TICKET_RELATED_TICKET_ADDED',
    'TICKET_RELATED_TICKET_REMOVED',
    'CHANNEL_MESSAGE',
    'MENTION',
    'WORKFLOW_COMPLETION',
    'WORKFLOW_FAILURE',
  ]),
  z.object({
    browserEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    slackEnabled: z.boolean() })
);

export class NotificationController {
  async getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const status = req.query.status as string;

      const notifications = await notificationService.getUserNotifications(userId, {
        page,
        limit,
        status });

      res.json(notifications);
    } catch (error) {
      logger.error('Failed to get notifications:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const notificationId = req.params.id;
      const { channelId, conversationId } = req.body;

      await notificationService.markAsRead(notificationId, userId);

      if (typeof channelId === 'string' && channelId.length > 0) {
        await unreadService.markChannelAsViewed(channelId, userId);
      }

      if (typeof conversationId === 'string' && conversationId.length > 0) {
        await unreadService.markThreadAsViewed(conversationId, userId);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async dismiss(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const notificationId = req.params.id;

      await notificationService.dismiss(notificationId, userId);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to dismiss notification:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const preferences = await notificationService.getUserPreferences(userId);

      res.json(preferences);
    } catch (error) {
      logger.error('Failed to get notification preferences:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Filter out invalid notification types for migration (like old SYSTEM_ALERTS)
      const validNotificationTypes = [
        'TICKET_STATUS_CHANGE',
        'TICKET_ASSIGNMENT',
        'TICKET_REASSIGNMENT',
        'TICKET_DUE_DATE_CHANGED',
        'TICKET_PRIORITY_CHANGED',
        'TICKET_USER_GROUP_CHANGED',
        'TICKET_TITLE_CHANGED',
        'TICKET_DESCRIPTION_CHANGED',
        'TICKET_RCA_CREATED',
        'TICKET_RCA_UPDATED',
        'TICKET_SUBTICKET_ADDED',
        'TICKET_RELATED_TICKET_ADDED',
        'TICKET_RELATED_TICKET_REMOVED',
        'CHANNEL_MESSAGE',
        'MENTION',
        'WORKFLOW_COMPLETION',
        'WORKFLOW_FAILURE',
      ];

      // First filter the request body to remove invalid types before validation
      const filteredData = Object.fromEntries(
        Object.entries(req.body).filter(([key]) => validNotificationTypes.includes(key))
      );

      const validatedData = preferencesSchema.parse(filteredData);

      await notificationService.updateUserPreferences(userId, validatedData);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update notification preferences:', error);

      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid preferences data', details: error.issues });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getWorkspaceNotificationCounts(req: Request, res: Response): Promise<void> {
    try {
      const memberId = req.user?.memberId;
      if (!memberId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const counts = await notificationService.getWorkspaceNotificationCounts(memberId);

      res.json({ counts });
    } catch (error) {
      logger.error('Failed to get workspace notification counts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

}

export const notificationController = new NotificationController();
