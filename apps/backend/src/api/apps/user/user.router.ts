import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { userInfo } from './user.controller';
import { appPermission } from '@/apps/access';

/** `/apps/user` (bot token). */
export const userRouter = router(api.apps.user, { auth: 'app' }, (serve) => ({
  info: serve('info', {
    access: { permission: appPermission('users:read') },
    controller: ({ query }) => userInfo({ query }),
  }),
}));
