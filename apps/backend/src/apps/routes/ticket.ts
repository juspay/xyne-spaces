import { Router } from 'express';
import { TicketController } from '../controllers/ticketController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';
import { uploadMultiple } from '@/middleware/upload';

const router = Router();
const ticketController = new TicketController();

router.post('/createTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.createTicket);
router.post('/createEmailTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.createEmailTicket);
router.post('/appDeskInbound', requirePermission('desk:write'), uploadMultiple, validateChannelAccessForPost, ticketController.appDeskInbound);
router.post('/updateTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.updateTicket);
router.post('/updateFormField', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.updateFormField);
router.post('/disableEmailSend', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.disableEmailSend);
router.post('/enableEmailSend', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.enableEmailSend);
router.get('/listBySender', requirePermission('tickets:read'), ticketController.listBySender);
router.post('/list/search', requirePermission('tickets:read'), ticketController.searchTickets);
router.get('/:ticketId/conversation', requirePermission('tickets:read'), ticketController.getConversation);
router.get('/:xyneId', requirePermission('tickets:read'), ticketController.getInfo);


export default router;
