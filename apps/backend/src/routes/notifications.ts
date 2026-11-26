import { Router } from 'express';
import { notificationController } from '@/controllers/notificationController';
import { authMiddleware } from '@/middleware/auth';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// Not moved: the list of notifications (titles and message text).
const router = Router();
router.use(authMiddleware.authenticate);
router.get('/', notificationController.getNotifications);

export default router;
