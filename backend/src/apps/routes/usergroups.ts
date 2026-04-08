import { Router } from 'express';
import { UserGroupController } from '../controllers/userGroupController';

const router = Router();
const userGroupController = new UserGroupController();

router.get('/list', userGroupController.listUserGroups);

export default router;
