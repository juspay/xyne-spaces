import { Router } from 'express';
import { InternalController } from '@/controllers/internalController';
import { internalServiceAuth } from '@/middleware/internalServiceAuth';

const router = Router();
const internalController = new InternalController();

router.get('/org-members/check', internalServiceAuth, internalController.checkOrgMember);
router.post('/auth/email/login', internalServiceAuth, internalController.loginOrgMember);

export default router;
