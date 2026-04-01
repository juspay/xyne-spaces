import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';

const router = Router();
const ticketController = new TicketController();

router.post('/createTicket', validateChannelAccessForPost, ticketController.createTicket);
router.post('/updateTicket', validateChannelAccessForPost, ticketController.updateTicket);

export default router;
