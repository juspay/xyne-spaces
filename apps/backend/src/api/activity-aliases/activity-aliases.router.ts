import { API, AccessType } from '@xyne/shared';
import { api } from '@/framework/api';
import { createAlias, deleteAlias, listAliases, updateAlias } from './activity-aliases.controller';
import { resourceAccess } from '@/framework/dashboardAccess';

const userActivityAdmin = { access: { userActivity: resourceAccess('USER_ACTIVITY', AccessType.ADMIN) } };

/** `/activity-aliases`: listing needs a login only; changes need USER_ACTIVITY admin access. */
export const activityAliasesRouter = api.router(API.activityAliases, {}, (serve) => ({
  list: serve('list', { controller: () => listAliases() }),
  create: serve('create', { ...userActivityAdmin, controller: ({ body }) => createAlias({ body }) }),
  update: serve('update', { ...userActivityAdmin, controller: ({ params, body }) => updateAlias({ params, body }) }),
  delete: serve('delete', { ...userActivityAdmin, successStatus: 204, controller: ({ params }) => deleteAlias({ params }) }),
}));
