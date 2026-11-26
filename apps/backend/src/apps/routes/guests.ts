// /api/apps/guests: an app's own guest users (people outside the workspace it serves) and
// the Spaces tokens they use with the SDK.
import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appPermission } from '../access';
import { appGuestToken, createAppGuest, listAppGuests, updateAppGuest } from '../handlers/users';

// Typed routes (API.apps.guests), served by the API router behind the contract gate.
api.routes(API.apps.guests, (serve) => ({
  create: serve('create', {
    auth: 'app',
    access: { permission: appPermission('guests:write') },
    successStatus: 201,
    handle: ({ body, user, app }) => createAppGuest({ body, user, app }),
  }),
  get: serve('get', {
    auth: 'app',
    access: { permission: appPermission('guests:read') },
    handle: ({ body, user, app }) => listAppGuests({ body, user, app }),
  }),
  update: serve('update', {
    auth: 'app',
    access: { permission: appPermission('guests:write') },
    handle: ({ body, user, app }) => updateAppGuest({ body, user, app }),
  }),
  token: serve('token', {
    auth: 'app',
    access: { permission: appPermission('guests:write') },
    handle: ({ body, user, app }) => appGuestToken({ body, user, app }),
  }),
}));

// Nothing untyped left under /api/apps/guests.
const router = Router();
export default router;
