import { Router } from 'express';
import { AccessType, API } from '@xyne/shared';
import { api } from '@/framework/api';
import { resourceAccess } from '@/framework/dashboardAccess';
import { allHeaderOverrides, myHeaderOverrides, postClientEvent, removeHeaderOverrides } from '@/handlers/settings';

// Typed routes (API.clientEvents), served by the API router behind the contract gate. `me` needs
// a login only; the rest need TICKET-MIGRATION admin access.
const clientEventsAdmin = { access: { ticketMigration: resourceAccess('TICKET-MIGRATION', AccessType.ADMIN) } };

api.routes(API.clientEvents, (serve) => ({
  mine: serve('mine', { handle: ({ user }) => myHeaderOverrides({ user }) }),
  list: serve('list', { ...clientEventsAdmin, handle: ({ user }) => allHeaderOverrides({ user }) }),
  post: serve('post', { ...clientEventsAdmin, handle: ({ body, user }) => postClientEvent({ body, user }) }),
  remove: serve('remove', { ...clientEventsAdmin, handle: ({ body, user }) => removeHeaderOverrides({ body, user }) }),
}));

// Nothing untyped left under /api/client-events.
const router = Router();
export default router;
