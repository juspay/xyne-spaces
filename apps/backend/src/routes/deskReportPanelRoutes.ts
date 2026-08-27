import { Router } from 'express';
import { deskReportPanelController } from '@/controllers/deskReportPanelController';

const router = Router();

router.get('/:channelId/latest', deskReportPanelController.getLatest);
router.get('/:channelId/view', deskReportPanelController.serveReport);
// Manual "generate now" is desk-owner/channel-admin only — see
// generateNow's own check for why this isn't org-level requireAdminOrOwner.
router.post('/:channelId/generate', deskReportPanelController.generateNow);

export default router;
