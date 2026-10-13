// /api/apps/guests: an app's own guest users (people outside the workspace it serves) and
// the Spaces tokens they use with the SDK. Mounted behind authenticateApp.
import { Router } from 'express';
import { requirePermission } from '@/middleware/requirePermission';
import { GuestController } from '../controllers/guestController';

const router = Router();
const guestController = new GuestController();

router.post('/create', requirePermission('guests:write', { strict: true }), guestController.create);
router.post('/get', requirePermission('guests:read', { strict: true }), guestController.list);
router.post('/update', requirePermission('guests:write', { strict: true }), guestController.update);
router.post('/token', requirePermission('guests:write', { strict: true }), guestController.token);

export default router;
