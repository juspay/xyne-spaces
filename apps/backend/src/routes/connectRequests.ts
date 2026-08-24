import { Router } from 'express';
import { connectRequestController } from '@/controllers/connectRequestController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// Public (token-based) — the guest accept page reads this before sign-in.
router.get('/:token/verify', connectRequestController.verify);

// Authenticated
const auth = authMiddleware.authenticate;

// Admin inboxes (workspace-management page)
router.get('/outbox', auth, connectRequestController.outbox);
router.get('/inbox', auth, connectRequestController.inbox);

// Channel connect toggle
router.post('/channels/:channelId/enable-connect', auth, connectRequestController.enableConnect);
router.post('/channels/:channelId/disable-connect', auth, connectRequestController.disableConnect);
router.get('/channels/:channelId/can-disable-connect', auth, connectRequestController.canDisableConnect);

// Per-channel pending invites (Invite External tab)
router.get('/channel/:channelId', auth, connectRequestController.listForChannel);

// Invite + handshake
router.post('/', auth, connectRequestController.invite);
router.post('/:id/host-approve', auth, connectRequestController.hostApprove);
router.post('/:id/guest-approve', auth, connectRequestController.guestApprove);
router.post('/:id/reject', auth, connectRequestController.reject);
router.post('/:token/accept', auth, connectRequestController.accept);

export default router;
