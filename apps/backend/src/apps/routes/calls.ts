import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { AppCallController } from '../controllers/callController';
import { requirePermission } from '@/middleware/requirePermission';
import { appPermission } from '../access';
import { getCall, getSummaryTemplate, listSummaryTemplates } from '../handlers/callsTickets';

// Typed routes (API.apps.calls), served by the API router behind the contract gate. The
// summary-template routes come first so /:callId does not capture 'summary-templates'.
api.routes(API.apps.calls, (serve) => ({
  summaryTemplates: serve('summaryTemplates', {
    auth: 'app',
    access: { permission: appPermission('summaries:read') },
    handle: ({ user }) => listSummaryTemplates({ user }),
  }),
  summaryTemplate: serve('summaryTemplate', {
    auth: 'app',
    access: { permission: appPermission('summaries:read') },
    handle: ({ params, user }) => getSummaryTemplate({ params, user }),
  }),
  get: serve('get', {
    auth: 'app',
    access: { permission: appPermission('calls:read') },
    handle: ({ params, user }) => getCall({ params, user }),
  }),
}));

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
