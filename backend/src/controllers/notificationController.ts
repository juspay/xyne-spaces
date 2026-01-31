import { Request, Response } from 'express';
import { notificationService } from '@/services/notificationService';
import { apnsService } from '@/services/apnsService';
import { logger } from '@/utils/logger';
import { z } from 'zod';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

const MIN_FCM_TOKEN_LENGTH = 100;
const mobilePlatformSchema = z.enum(['ios', 'android', 'unknown']);

const mobileRegisterSchema = z.object({
  token: z.string().min(MIN_FCM_TOKEN_LENGTH),
  voipToken: z.string().optional(),
  platform: mobilePlatformSchema.default('unknown'),
  deviceId: z.string().max(255).optional(),
});

const mobileUnregisterSchema = z.object({}).strict();

const preferencesSchema = z.record(
  z.enum([
    'TICKET_STATUS_CHANGE',
    'TICKET_ASSIGNMENT',
    'TICKET_REASSIGNMENT',
    'MENTION',
    'WORKFLOW_COMPLETION',
    'WORKFLOW_FAILURE',
  ]),
  z.object({
    browserEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    slackEnabled: z.boolean(),
  })
);

export class NotificationController {
  private resolveSessionId(req: Request): string | undefined {
    return req.authenticatedSessionId;
  }

  async getVapidPublicKey(_req: Request, res: Response): Promise<void> {
    try {
      const publicKey = process.env.VAPID_PUBLIC_KEY;

      if (!publicKey) {
        res.status(500).json({ error: 'VAPID public key not configured' });
        return;
      }

      res.json({ publicKey });
    } catch (error) {
      logger.error('Failed to get VAPID public key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  registerMobilePushToken = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const validated = mobileRegisterSchema.parse(req.body);
      const sessionId = this.resolveSessionId(req);

      await notificationService.registerMobilePushToken(userId, {
        ...validated,
        sessionId: sessionId ?? undefined,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to register mobile push token:', error);

      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid mobile token data', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  unregisterMobilePushToken = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      mobileUnregisterSchema.parse(req.body ?? {});
      const sessionId = this.resolveSessionId(req);

      await notificationService.unregisterMobilePushToken(userId, sessionId ?? undefined);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to unregister mobile push token:', error);

      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid mobile token data', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  async subscribe(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const validatedData = subscribeSchema.parse(req.body);

      await notificationService.saveSubscription(userId, {
        endpoint: validatedData.endpoint,
        p256dh: validatedData.keys.p256dh,
        auth: validatedData.keys.auth,
        userAgent: req.get('User-Agent') || undefined,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to save notification subscription:', error);

      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid subscription data', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async unsubscribe(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const validatedData = unsubscribeSchema.parse(req.body);

      await notificationService.removeSubscription(userId, validatedData.endpoint);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to remove notification subscription:', error);

      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid unsubscribe data', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  }

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
        status,
      });

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

      await notificationService.markAsRead(notificationId, userId);

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
        res.status(400).json({ error: 'Invalid preferences data', details: error.errors });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async markAllAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await notificationService.markAllAsRead(userId);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getUnreadCount(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const count = await notificationService.getUnreadCount(userId);

      res.json({ count });
    } catch (error) {
      logger.error('Failed to get unread notification count:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async sendTestNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Create a test notification in the database
      await notificationService.createNotification(userId, {
        title: 'Test Notification',
        message: 'This is a test notification from Xyne Spaces',
        type: 'WORKFLOW_COMPLETION',
        relatedEntityType: 'test',
        relatedEntityId: 'test-' + Date.now(),
        actionUrl: '/notifications',
      });

      res.json({ success: true, message: 'Test notification created successfully' });
    } catch (error) {
      logger.error('Failed to send test notification:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async sendTestVoipPush(req: Request, res: Response): Promise<void> {
    try {
      const { voipToken, callerName, callerId, actionUrl } = req.body;

      if (!voipToken) {
        res.status(400).json({ error: 'voipToken is required' });
        return;
      }

      // Extract call ID from actionUrl (e.g., https://domain/call/uuid?type=AUDIO)
      let relatedEntityId: string | undefined;
      if (actionUrl) {
        try {
          const url = new URL(actionUrl);
          const pathParts = url.pathname.split('/');
          const callIndex = pathParts.indexOf('call');
          if (callIndex !== -1 && pathParts[callIndex + 1]) {
            relatedEntityId = pathParts[callIndex + 1];
            logger.info('[sendTestVoipPush] Extracted call ID from actionUrl', { relatedEntityId });
          }
        } catch {
          logger.warn('[sendTestVoipPush] Failed to parse actionUrl', { actionUrl });
        }
      }

      const success = await apnsService.sendVoipPush(voipToken, {
        title: 'Incoming Space Call',
        message: 'Someone is calling you',
        type: 'INCOMING_CALL',
        callerName: callerName || 'Xyne User',
        handle: callerId || 'xyne-call',
        actionUrl: actionUrl,
        relatedEntityId,
        relatedEntityType: 'call',
        metadata: {},
      });

      if (success) {
        res.json({ success: true, message: 'VoIP push sent', callId: relatedEntityId });
      } else {
        res
          .status(500)
          .json({ error: 'Failed to send VoIP push', enabled: apnsService.isSendEnabled() });
      }
    } catch (error) {
      logger.error('Failed to send test VoIP push:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async sendTestApnsPush(req: Request, res: Response): Promise<void> {
    try {
      const { apnsToken, title, message } = req.body;

      if (!apnsToken) {
        res.status(400).json({ error: 'apnsToken is required' });
        return;
      }

      const success = await apnsService.sendStandardPush(apnsToken, {
        title: title || 'Test Alert',
        message: message || 'This is a standard APNS push notification',
        type: 'TEST_PUSH',
        metadata: {
          test: true,
          timestamp: Date.now(),
        },
      });

      if (success) {
        res.json({ success: true, message: 'Standard APNS push sent' });
      } else {
        res.status(500).json({
          error: 'Failed to send standard APNS push',
          enabled: apnsService.isSendEnabled(),
        });
      }
    } catch (error) {
      logger.error('Failed to send test APNS push:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getQueueStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = await notificationService.getStats();
      if (stats) {
        res.json(stats);
      } else {
        res.status(500).json({ error: 'Failed to retrieve queue stats' });
      }
    } catch (error) {
      logger.error('Failed to get queue stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const notificationController = new NotificationController();
