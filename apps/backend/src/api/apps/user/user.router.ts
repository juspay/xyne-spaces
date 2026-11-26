import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { userInfo } from './user.controller';
import { appPermission } from '@/apps/access';

/** `/apps/user` (bot token). */
export const userRouter = api.router(API.apps.user, { auth: 'app' }, (serve) => ({
  info: serve('info', {
    access: { permission: appPermission('users:read') },
    controller: ({ query }) => userInfo({ query }),
  }),
}));
