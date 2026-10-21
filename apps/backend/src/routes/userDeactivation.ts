import { Router } from 'express';
import { InternalController } from '@/controllers/internalController';
import { userDeactivationAuth } from '@/middleware/userDeactivationAuth';

const router = Router();
const internalController = new InternalController();

// POST /api/internal/users/deactivate?email=:email
// Called from outside the cluster, so it is mounted under /api (the only prefix
// the public gateway routes to the backend) rather than on the cluster-only
// /internal router, and guarded by its own secret — see userDeactivationAuth.
router.post('/deactivate', userDeactivationAuth, internalController.deactivateUser);

export default router;
