import { Router } from 'express';
import { invitationController } from '@/controllers/invitationController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// Public routes - no authentication required
router.get('/:id/verify', invitationController.verifyInvitation);

// Protected routes - require authentication
router.post('/', authMiddleware.authenticate, invitationController.createInvitation);

router.get('/pending-approvals', authMiddleware.authenticate, invitationController.listPendingApprovals);
router.post('/:id/approve', authMiddleware.authenticate, invitationController.approveInvitation);
router.post('/:id/reject', authMiddleware.authenticate, invitationController.rejectInvitation);
// Admin: provision a new org + workspace + owner invitation in one shot
router.post('/provision-org', authMiddleware.authenticate, authMiddleware.requireAdminOrOwner, invitationController.provisionOrg,);
// Unified accept — handles OAuth or email+password
router.post('/:id/accept', invitationController.acceptInvitation);

export default router;
