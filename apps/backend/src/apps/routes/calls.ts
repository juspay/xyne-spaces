import { Router } from 'express';
import { AppCallController } from '../controllers/callController';
import { requirePermission } from '@/middleware/requirePermission';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// Untyped: schedule / update / cancel hand the request to the dashboard's scheduleCallController;
// transcript and summary return content (response encryption not designed yet).

const router = Router();
const callController = new AppCallController();

router.post('/schedule', requirePermission('calls:write'), callController.scheduleCall);

router.get('/:callId/transcript', requirePermission('calls:read'), callController.getTranscript);
router.get('/:callId/summary', requirePermission('summaries:read'), callController.getSummary);
// Disabled (LLM)
// router.post(
//   '/:callId/regenerate-summary',
//   requirePermission('summaries:write'),
//   callController.regenerateSummary,
// );
router.patch('/:callId', requirePermission('calls:write'), callController.updateScheduledCall);
router.delete('/:callId', requirePermission('calls:write'), callController.cancelScheduledCall);

export default router;
