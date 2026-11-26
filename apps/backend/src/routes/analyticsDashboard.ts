import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AnalyticsDashboardController as ctrl } from '@/controllers/analyticsDashboardController';
import { authorize } from '@/middleware/authorize';

// Legacy analytics dashboards (the `dashboards` table). Changing who a dashboard is shared with
// needs the ANALYTICS permission (write); the controller then checks the caller's role on it.
const router = Router();
router.use(authorize('ANALYTICS', AccessType.WRITE));

router.post('/:id/shares', ctrl.addShares);
router.patch('/:id/shares/:shareId', ctrl.updateShareRole);
router.delete('/:id/shares/:shareId', ctrl.removeShare);

export default router;
