import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const userController = new UserController();

router.get('/info', requirePermission('users:read'), userController.getUserInfo);

// Status of the app's own user — target is always the authenticated app user.
router.post('/status', requirePermission('users:write'), userController.setStatus);
router.delete('/status', requirePermission('users:write'), userController.deleteStatus);

export default router;
