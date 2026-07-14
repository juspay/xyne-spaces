import { Router } from 'express';
import { notificationController } from '@/controllers/notificationController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// All notification endpoints require authentication
router.use(authMiddleware.authenticate);

// VAPID public key - now requires auth (only logged-in users can set up notifications)
router.get('/vapid-public-key', notificationController.getVapidPublicKey);

// Subscription management
router.post('/subscribe', notificationController.subscribe);
router.delete('/unsubscribe', notificationController.unsubscribe);
router.post('/mobile/register', notificationController.registerMobilePushToken);
router.post('/mobile/unregister', notificationController.unregisterMobilePushToken);

// Notification management
router.get('/', notificationController.getNotifications);
router.get('/queue-stats', notificationController.getQueueStats);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/workspace-counts', notificationController.getWorkspaceNotificationCounts);
router.post('/test', notificationController.sendTestNotification);
router.post('/test-voip', authMiddleware.requireAdmin, notificationController.sendTestVoipPush);
router.post('/test-apns', authMiddleware.requireAdmin, notificationController.sendTestApnsPush);
router.patch('/mark-all-read', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);
router.patch('/:id/dismiss', notificationController.dismiss);

// Preferences
router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', notificationController.updatePreferences);

export default router;
