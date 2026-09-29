import { Router } from 'express';
import { InternalController } from '@/controllers/internalController';
import { internalServiceAuth } from '@/middleware/internalServiceAuth';
import { userDeactivationAuth } from '@/middleware/userDeactivationAuth';

const router = Router();
const internalController = new InternalController();

router.get('/org-members/check', internalServiceAuth, internalController.checkOrgMember);
router.post('/auth/email/login', internalServiceAuth, internalController.loginOrgMember);
// Guarded by its own secret, not the shared internal one — see userDeactivationAuth.
router.post('/users/deactivate', userDeactivationAuth, internalController.deactivateUser);

export default router;
