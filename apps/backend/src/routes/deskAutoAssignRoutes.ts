import { Router } from 'express';
import { DeskAutoAssignController } from '../controllers/deskAutoAssignController';

const router = Router({ mergeParams: true }); // mergeParams to access :channelId from parent
const controller = new DeskAutoAssignController();

// POST /channels/:channelId/desk/auto-assign-unassigned
// Authentication applied at the app level.
router.post('/auto-assign-unassigned', controller.autoAssignUnassigned);

export default router;
