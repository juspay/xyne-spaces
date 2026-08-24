import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const userController = new UserController();

router.get('/info', requirePermission('users:read'), userController.getUserInfo);
router.post('/status', requirePermission('users:write'), userController.setOwnStatus);

export default router;
