import { Router } from 'express';
import { UserGroupController } from '../controllers/userGroupController';

const router = Router();
const controller = new UserGroupController();

// User group routes
router.post('/', controller.createGroup);

export default router;
