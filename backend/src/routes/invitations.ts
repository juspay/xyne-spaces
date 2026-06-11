import { Router } from 'express';
import { invitationController } from '@/controllers/invitationController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// Public routes - no authentication required
router.get('/:id/verify', invitationController.verifyInvitation);

// Protected routes - require authentication
router.post('/', authMiddleware.authenticate, invitationController.createInvitation);
// Admin: provision a new org + workspace + owner invitation in one shot
router.post('/provision-org', authMiddleware.authenticate, invitationController.provisionOrg);
// Unified accept — handles OAuth or email+password
router.post('/:id/accept', invitationController.acceptInvitation);

export default router;
