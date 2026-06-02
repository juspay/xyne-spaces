import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { validateChannelAccessForPost, validateChannelAccessForGet} from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const ticketController = new TicketController();

router.post('/createTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.createTicket);
router.post('/updateTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.updateTicket);
router.get('/:ticketId', requirePermission('tickets:read'), validateChannelAccessForGet, ticketController.getInfo);

export default router;
