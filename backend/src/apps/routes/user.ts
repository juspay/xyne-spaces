import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const userController = new UserController();

router.get('/info', requirePermission('users:read'), userController.getUserInfo);

export default router;
