import { Router } from 'express';
import { requirePermission } from '@/middleware/requirePermission';
import { AppChannelController } from '../controllers/appChannelController';

const router = Router();
const appChannelController = new AppChannelController();
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// ─── Untyped (create calls the dashboard controller with the request: not moved yet) ──
router.post('/create', requirePermission('channels:write'), appChannelController.create);

export default router;
