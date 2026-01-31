import { NotificationChannelHandler, NotificationEvent, NotificationDeliveryResult } from '../types';
import { redisService } from '@/services/redisService';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';

export class WebSocketNotificationChannel implements NotificationChannelHandler {
  
  async deliver(event: NotificationEvent): Promise<NotificationDeliveryResult> {
    try {
      logger.info(`Delivering WebSocket notification to user ${event.userId}:`, {
        eventId: event.id,
        type: event.type,
        title: event.title
      });

      const userConnections = await redisService.getUserConnections(event.userId);

      if (userConnections.length === 0) {
        return {
          success: false,
          error: 'User not connected'
        };
      }

      await websocketService.broadcastNotificationToUser(event.userId, {
        id: event.id,
        type: event.type,
        title: event.title,
        message: event.message,
        actionUrl: event.actionUrl,
        data: event.data,
        createdAt: event.createdAt
      });

      return {
        success: true,
        deliveredAt: new Date()
      };

    } catch (error) {
      logger.error(`Failed to deliver WebSocket notification to user ${event.userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async acknowledge(eventId: string, userId: string): Promise<boolean> {
    try {
      logger.info(`Acknowledging notification ${eventId} for user ${userId}`);
      
      // Broadcast acknowledgment to user's other connections
      await websocketService.broadcastNotificationUpdate(userId, eventId, 'acknowledged');
      
      return true;
    } catch (error) {
      logger.error(`Failed to acknowledge notification ${eventId} for user ${userId}:`, error);
      return false;
    }
  }
}