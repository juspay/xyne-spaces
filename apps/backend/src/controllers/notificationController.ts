import { Request, Response } from 'express';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

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

}

export const notificationController = new NotificationController();
