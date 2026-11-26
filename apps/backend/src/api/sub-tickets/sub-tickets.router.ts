import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { linkSubTicket, unlinkSubTicketHandler } from './sub-tickets.controller';

/** `/sub-tickets` (login). */
export const subTicketsRouter = api.router(API.subTickets, {}, (serve) => ({
  link: serve('link', { successStatus: 201, controller: ({ body, user }) => linkSubTicket({ body, user }) }),
  unlink: serve('unlink', { successStatus: 204, controller: ({ body, user }) => unlinkSubTicketHandler({ body, user }) }),
}));
