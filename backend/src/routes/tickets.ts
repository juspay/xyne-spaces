import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { ReleaseNotesController } from '../controllers/releaseNotesController';
import { AnalyticsController } from '../controllers/analyticsController';
import { uploadMultiple } from '../middleware/upload';
import { validate } from '../middleware/validation';
import { ticketDuplicateCheckSchema } from '../validators/ticketDuplicateValidator';
import { ticketBoardSuggestionSchema } from '../validators/ticketBoardValidator';

const router = Router();
const ticketController = new TicketController();
const releaseNotesController = new ReleaseNotesController();
const analyticsController = new AnalyticsController();

// Note: Authentication and ACL middleware are applied at the app level

// Create a new ticket
router.post('/', uploadMultiple, ticketController.createTicket);
// Update a ticket (assignee, stage, group, title, description, priority, status, eta)
router.patch('/:ticketId', ticketController.updateTicket);

// Workflow metrics for tickets dashboard
router.get('/workflow-metrics', analyticsController.getWorkflowMetrics);
router.post('/duplicates', validate(ticketDuplicateCheckSchema), ticketController.checkDuplicateTickets);
router.post('/suggest-board', validate(ticketBoardSuggestionSchema), ticketController.suggestBoard);

router.get('/:ticketId/pending-human-intervention', ticketController.getPendingHumanIntervention);

router.post('/:ticketId/attachments/from-conversation', ticketController.addAttachmentsFromConversation);

router.post('/:ticketId/release-notes/generate', releaseNotesController.generateReleaseNotes);

export default router;
