import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { linkSubTicket, unlinkSubTicketHandler } from './sub-tickets.controller';

/** `/sub-tickets` (login). */
export const subTicketsRouter = router(api.subTickets, {}, (serve) => ({
  link: serve('link', { successStatus: 201, controller: ({ body, user }) => linkSubTicket({ body, user }) }),
  unlink: serve('unlink', { successStatus: 204, controller: ({ body, user }) => unlinkSubTicketHandler({ body, user }) }),
}));
