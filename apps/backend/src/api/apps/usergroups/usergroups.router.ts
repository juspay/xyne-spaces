import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { listUserGroups } from './usergroups.controller';
import { appPermission } from '@/apps/access';

/** `/apps/usergroups` (bot token). */
export const usergroupsRouter = api.router(API.apps.usergroups, { auth: 'app' }, (serve) => ({
  list: serve('list', {
    access: { permission: appPermission('usergroups:read') },
    controller: () => listUserGroups(),
  }),
}));
