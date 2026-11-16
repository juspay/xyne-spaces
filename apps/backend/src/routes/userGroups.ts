import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { UserGroupController } from '../controllers/userGroupController';
import { authorize } from '@/middleware/authorize';

const router = Router();
const controller = new UserGroupController();

// User group routes
// Creating a group can hand its members roles (e.g. stage-approver roles), so it requires
// USER-GROUPS ADMIN (direct or via a group) — the same rule as the Zero user_groups insert ACL.
router.post('/', authorize('USER-GROUPS', AccessType.ADMIN), controller.createGroup);

export default router;
