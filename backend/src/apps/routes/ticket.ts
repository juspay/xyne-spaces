import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { validateChannelAccess } from '../middelware/channelValidation';

const router = Router();
const ticketController = new TicketController();

router.post('/createTicket', validateChannelAccess, ticketController.createTicket);

export default router;
