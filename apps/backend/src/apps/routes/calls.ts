import { Router } from 'express';
import { AppCallController } from '../controllers/callController';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const callController = new AppCallController();

router.post('/schedule', requirePermission('calls:write'), callController.scheduleCall);

// Literal paths stay ABOVE the /:callId routes below, or 'summary-templates' is
// captured as a call id.
router.get(
  '/summary-templates',
  requirePermission('summaries:read'),
  callController.listSummaryTemplates,
);
router.get(
  '/summary-templates/:templateId',
  requirePermission('summaries:read'),
  callController.getSummaryTemplate,
);

router.get('/:callId', requirePermission('calls:read'), callController.getCall);
router.get('/:callId/transcript', requirePermission('calls:read'), callController.getTranscript);
router.get('/:callId/summary', requirePermission('summaries:read'), callController.getSummary);
router.post(
  '/:callId/regenerate-summary',
  requirePermission('summaries:write'),
  callController.regenerateSummary,
);
router.patch('/:callId', requirePermission('calls:write'), callController.updateScheduledCall);

export default router;
