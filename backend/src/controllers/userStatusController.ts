import { Request, Response } from 'express';
import { userStatusService } from '../services/userStatusService';
import { logger } from '../utils/logger';
import { UserPresenceStatus } from '@prisma/client';

export class UserStatusController {
  // Get current user's status
  async getCurrentUserStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const status = await userStatusService.getUserStatus(userId);

      res.json({
        success: true,
        status: status || { status: 'OFFLINE', lastActiveAt: new Date().toISOString() }
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS-API] Error getting user status:', error);
      res.status(500).json({ error: 'Failed to get user status' });
    }
  }



  // Get all online users
  async getOnlineUsers(_req: Request, res: Response): Promise<void> {
    try {
      const onlineUsers = await userStatusService.getOnlineUsers();

      res.json({
        success: true,
        onlineUsers,
        count: onlineUsers.length
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS-API] Error getting online users:', error);
      res.status(500).json({ error: 'Failed to get online users' });
    }
  }

  // Get users by status
  async getUsersByStatus(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.params;

      // Validate status
      if (!['ONLINE', 'AWAY', 'OFFLINE'].includes(status)) {
        res.status(400).json({ error: 'Invalid status. Must be ONLINE, AWAY, or OFFLINE' });
        return;
      }

      const users = await userStatusService.getUsersByStatus(status as UserPresenceStatus);

      res.json({
        success: true,
        users,
        count: users.length,
        status
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS-API] Error getting users by status:', error);
      res.status(500).json({ error: 'Failed to get users by status' });
    }
  }

  // Get presence statistics
  async getPresenceStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = await userStatusService.getPresenceStats();

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS-API] Error getting presence stats:', error);
      res.status(500).json({ error: 'Failed to get presence stats' });
    }
  }

  // Update user activity (heartbeat)
  async updateActivity(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const deviceInfo = req.headers['user-agent']?.substring(0, 100) || 'Unknown';
      await userStatusService.updateUserActivity(userId, deviceInfo);

      res.json({
        success: true,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('❌ [USER-STATUS-API] Error updating user activity:', error);
      res.status(500).json({ error: 'Failed to update user activity' });
    }
  }

}

export const userStatusController = new UserStatusController();