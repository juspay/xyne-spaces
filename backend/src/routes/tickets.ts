import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { uploadMultiple } from '../middleware/upload';
import { validate } from '../middleware/validation';
import { ticketDuplicateCheckSchema } from '../validators/ticketDuplicateValidator';

const router = Router();
const ticketController = new TicketController();

// Note: Authentication and ACL middleware are applied at the app level

// Create a new ticket
router.post('/', uploadMultiple, ticketController.createTicket);
router.post('/duplicates', validate(ticketDuplicateCheckSchema), ticketController.checkDuplicateTickets);

router.get('/:ticketId/pending-human-intervention', ticketController.getPendingHumanIntervention);

export default router;
