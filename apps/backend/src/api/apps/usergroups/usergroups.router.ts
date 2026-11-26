import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { listUserGroups } from './usergroups.controller';
import { appPermission } from '@/apps/access';

/** `/apps/usergroups` (bot token). */
export const usergroupsRouter = router(api.apps.usergroups, { auth: 'app' }, (serve) => ({
  list: serve('list', {
    access: { permission: appPermission('usergroups:read') },
    controller: () => listUserGroups(),
  }),
}));
