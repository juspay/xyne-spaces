import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appPermission } from '../access';
import { listBoardStages, listBoards, listBySender } from '../handlers/callsTickets';
import { TicketController } from '../controllers/ticketController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';
import { uploadMultiple } from '@/middleware/upload';

const router = Router();

// Typed routes (API.apps.ticket), served by the API router behind the contract gate.
api.routes(API.apps.ticket, (serve) => ({
  boards: serve('boards', {
    auth: 'app',
    access: { permission: appPermission('tickets:read') },
    handle: ({ query, user }) => listBoards({ query, user }),
  }),
  boardStages: serve('boardStages', {
    auth: 'app',
    access: { permission: appPermission('tickets:read') },
    handle: ({ params, user }) => listBoardStages({ params, user }),
  }),
  listBySender: serve('listBySender', {
    auth: 'app',
    access: { permission: appPermission('tickets:read') },
    handle: ({ query, user }) => listBySender({ query, user }),
  }),
}));
const ticketController = new TicketController();

router.post('/createTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.createTicket);
router.post('/createEmailTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.createEmailTicket);
router.post('/appDeskInbound', requirePermission('desk:write'), uploadMultiple, validateChannelAccessForPost, ticketController.appDeskInbound);
router.post('/updateTicket', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.updateTicket);
router.post('/updateFormField', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.updateFormField);
router.post('/disableEmailSend', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.disableEmailSend);
router.post('/enableEmailSend', requirePermission('tickets:write'), validateChannelAccessForPost, ticketController.enableEmailSend);
router.post('/list/search', requirePermission('tickets:read'), ticketController.searchTickets);
// Must stay above '/:xyneId' so "boards" isn't captured as a xyneId.
router.get('/:ticketId/conversation', requirePermission('tickets:read'), ticketController.getConversation);
router.get('/:xyneId', requirePermission('tickets:read'), ticketController.getInfo);


export default router;
