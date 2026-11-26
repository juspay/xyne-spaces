import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appGuestToken, createAppGuest, listAppGuests, updateAppGuest } from './guests.controller';
import { appPermission } from '@/apps/access';

/** `/apps/guests` (bot token). */
export const guestsRouter = api.router(API.apps.guests, { auth: 'app' }, (serve) => ({
  create: serve('create', {
    access: { permission: appPermission('guests:write') },
    successStatus: 201,
    controller: ({ body, user, app }) => createAppGuest({ body, user, app }),
  }),
  get: serve('get', {
    access: { permission: appPermission('guests:read') },
    controller: ({ body, user, app }) => listAppGuests({ body, user, app }),
  }),
  update: serve('update', {
    access: { permission: appPermission('guests:write') },
    controller: ({ body, user, app }) => updateAppGuest({ body, user, app }),
  }),
  token: serve('token', {
    access: { permission: appPermission('guests:write') },
    controller: ({ body, user, app }) => appGuestToken({ body, user, app }),
  }),
}));
