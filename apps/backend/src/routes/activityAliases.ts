import { Router } from 'express';
import { AccessType, API } from '@xyne/shared';
import { api } from '@/framework/api';
import { resourceAccess } from '@/framework/dashboardAccess';
import { createAlias, deleteAlias, listAliases, updateAlias } from '@/handlers/settings';

// Typed routes (API.activityAliases), served by the API router behind the contract gate. Listing
// needs a login only; changes need USER_ACTIVITY admin access.
const userActivityAdmin = { access: { userActivity: resourceAccess('USER_ACTIVITY', AccessType.ADMIN) } };

api.routes(API.activityAliases, (serve) => ({
  list: serve('list', { handle: () => listAliases() }),
  create: serve('create', { ...userActivityAdmin, handle: ({ body }) => createAlias({ body }) }),
  update: serve('update', { ...userActivityAdmin, handle: ({ params, body }) => updateAlias({ params, body }) }),
  delete: serve('delete', { ...userActivityAdmin, successStatus: 204, handle: ({ params }) => deleteAlias({ params }) }),
}));

// Nothing untyped left under /api/activity-aliases.
const router = Router();
export default router;
