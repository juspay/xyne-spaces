import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { TicketController } from '../controllers/ticketController';
import { ReleaseNotesController } from '../controllers/releaseNotesController';
import { AnalyticsController } from '../controllers/analyticsController';
import { KanbanTicketController } from '../controllers/kanbanTicketController';
import { uploadMultiple } from '../middleware/upload';
import { validate } from '../middleware/validation';
import { ticketDuplicateCheckSchema } from '../validators/ticketDuplicateValidator';
import { ticketBoardSuggestionSchema } from '../validators/ticketBoardValidator';
import { ReleaseReportController } from '@/controllers/releaseReportController';
import { authorize } from '@/middleware/authorize';
import { analyticsAuthMiddleware } from '@/middleware/analyticsAuth';
import { FlowRunExportController } from '@/controllers/flowRunExportController';

const router = Router();
const ticketController = new TicketController();
const releaseNotesController = new ReleaseNotesController();
const analyticsController = new AnalyticsController();
const kanbanTicketController = new KanbanTicketController();
const releaseReportController = new ReleaseReportController();
const flowRunExportController = new FlowRunExportController();

// Note: Authentication and ACL middleware are applied at the app level

// Kanban board counts grouped by the active view, filters, and group-by mode
router.post('/kanban/counts', kanbanTicketController.getCounts);
router.post('/flow-run-export/pdf', flowRunExportController.exportPdf);
router.get('/my-board-ids', ticketController.getMyTicketBoardIds);

// Create a new ticket
router.post('/', uploadMultiple, ticketController.createTicket);
router.post(
  '/:ticketId/flow-groups/:groupId/backlog',
  authorize('TICKETS', AccessType.WRITE),
  ticketController.backlogFlowGroup,
);
// Bulk add/remove tags across many tickets in one request (additive semantics)
router.post(
  '/bulk-tags',
  authorize('TICKETS', AccessType.WRITE),
  ticketController.bulkUpdateTags,
);

// Update a ticket (assignee, stage, group, title, description, priority, status, eta)
router.patch('/:ticketId', ticketController.updateTicket);

// Workflow metrics for tickets dashboard
router.get('/workflow-metrics', analyticsAuthMiddleware.requireWorkspaceContext, analyticsController.getWorkflowMetrics);
router.post('/duplicates', validate(ticketDuplicateCheckSchema), ticketController.checkDuplicateTickets);
router.post('/suggest-board', validate(ticketBoardSuggestionSchema), ticketController.suggestBoard);

router.get('/:ticketId/pending-human-intervention', ticketController.getPendingHumanIntervention);

// Active tags for the ticket's latest reply, grouped by category with configured color
router.get('/:ticketId/latest-email-tags', ticketController.getLatestEmailTags);

router.post('/:ticketId/attachments/from-conversation', ticketController.addAttachmentsFromConversation);

router.post('/:ticketId/release-notes/generate', releaseNotesController.generateReleaseNotes);
router.post(
  '/:ticketId/release-report/publish',
  authorize('TICKETS', AccessType.WRITE),
  releaseReportController.publish,
);

router.post('/:ticketId/merge', ticketController.mergeTicket);
router.post('/:ticketId/unmerge', ticketController.unmergeTicket);

export default router;
