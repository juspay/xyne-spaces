import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { listBoardStages, listBoards, listBySender } from './ticket.controller';
import { appPermission } from '@/apps/access';

/** `/apps/ticket` (bot token). */
export const ticketRouter = router(api.apps.ticket, { auth: 'app' }, (serve) => ({
  boards: serve('boards', {
    access: { permission: appPermission('tickets:read') },
    controller: ({ query, user }) => listBoards({ query, user }),
  }),
  boardStages: serve('boardStages', {
    access: { permission: appPermission('tickets:read') },
    controller: ({ params, user }) => listBoardStages({ params, user }),
  }),
  listBySender: serve('listBySender', {
    access: { permission: appPermission('tickets:read') },
    controller: ({ query, user }) => listBySender({ query, user }),
  }),
}));
