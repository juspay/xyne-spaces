import { API, AccessType } from '@xyne/shared';
import { api } from '@/framework/api';
import { getAppPermissions, listAvailablePermissions, setAppPermissions } from './permissions.controller';
import { xyneApps } from '@/api/apps/xyne-apps.access';

/** `/apps/permissions`: the permission registry (login only) and an app's template permissions (XYNE-APPS access). */
export const permissionsRouter = api.router(API.apps.permissions, {}, (serve) => ({

  // Permission management (user auth). The registry list is login only.
  list: serve('list', { controller: () => listAvailablePermissions() }),
  get: serve('get', { ...xyneApps(AccessType.READ), controller: ({ params }) => getAppPermissions({ params }) }),
  set: serve('set', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => setAppPermissions({ params, body, user }),
  }),
}));
