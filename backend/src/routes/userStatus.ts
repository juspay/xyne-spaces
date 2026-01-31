import { Router } from 'express';
import { userStatusController } from '../controllers/userStatusController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware.authenticate);

// User status routes
router.get('/status', userStatusController.getCurrentUserStatus);
router.put('/status', userStatusController.updateCurrentUserStatus);
router.post('/activity', userStatusController.updateActivity);

// Public status routes (for displaying online users)
router.get('/online', userStatusController.getOnlineUsers);
router.get('/stats', userStatusController.getPresenceStats);
router.get('/by-status/:status', userStatusController.getUsersByStatus);

export default router;