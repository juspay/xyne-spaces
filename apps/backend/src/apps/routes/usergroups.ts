import { Router } from 'express';
import { UserGroupController } from '../controllers/userGroupController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const userGroupController = new UserGroupController();

router.get('/list', requirePermission('usergroups:read'), userGroupController.listUserGroups);

export default router;
