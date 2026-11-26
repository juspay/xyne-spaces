import { API, AccessType } from '@xyne/shared';
import { api } from '@/framework/api';
import { allHeaderOverrides, myHeaderOverrides, postClientEvent, removeHeaderOverrides } from './client-events.controller';
import { resourceAccess } from '@/framework/dashboardAccess';

const clientEventsAdmin = { access: { ticketMigration: resourceAccess('TICKET-MIGRATION', AccessType.ADMIN) } };

/** `/client-events`: `me` needs a login only; the rest need TICKET-MIGRATION admin access. */
export const clientEventsRouter = api.router(API.clientEvents, {}, (serve) => ({
  mine: serve('mine', { controller: ({ user }) => myHeaderOverrides({ user }) }),
  list: serve('list', { ...clientEventsAdmin, controller: ({ user }) => allHeaderOverrides({ user }) }),
  post: serve('post', { ...clientEventsAdmin, controller: ({ body, user }) => postClientEvent({ body, user }) }),
  remove: serve('remove', { ...clientEventsAdmin, controller: ({ body, user }) => removeHeaderOverrides({ body, user }) }),
}));
